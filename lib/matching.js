import {
	deepStrictEqual,
	strictEqual,
} from 'node:assert/strict'
import pick from 'lodash/pick.js'
import parseTimeAsMilliseconds from 'gtfs-utils/lib/parse-time-as-milliseconds.js'
import {createLogger} from './logger.js'
import {protobufJsLongToBigInt} from './util.js'
import {
	queryActiveTripInstances as queryActiveScheduleTripInstances,
} from './gtfs-db.js'

const KIND_TRIP_UPDATE = 'tu'
const KIND_VEHICLE_POSITION = 'vp'

const tripDescriptorsMatch = (schedTripDesc, rtTripDesc) => {
	// We implement a stricter matching algorithm here than what the spec says:
	// > To specify a single trip instance, in many cases a trip_id by itself is sufficient. However, the following cases require additional information to resolve to a single trip instance:
	// > - If the trip lasts for more than 24 hours, or is delayed such that it would collide with a scheduled trip on the following day, then start_date is required in addition to trip_id.
	// > […]
	// – https://gtfs.org/documentation/realtime/reference/#message-tripdescriptor
	// We only allow `start_date` to be omitted if the trip's service schedule has exactly 1 date.
	// todo: consider if we should strictly follow the spec – analyse the mobility database's RT feeds if start_date is common
	if (
		schedTripDesc.trip_id && schedTripDesc.trip_id === rtTripDesc.trip_id
		&& (
			schedTripDesc.trip_has_only_1_service_date
			|| (schedTripDesc.start_date && schedTripDesc.start_date === rtTripDesc.start_date)
		)
	) {
		if (rtTripDesc.start_time && schedTripDesc.start_time !== rtTripDesc.start_time) {
			return false
		}
		// > - For trips defined in frequencies.txt, start_date and start_time are required in addition to trip_id
		return schedTripDesc.trip_has_frequencies
			? Boolean(rtTripDesc.start_time && schedTripDesc.start_time === rtTripDesc.start_time)
			: true
	}
	// > - If the trip_id field can't be provided, then route_id, direction_id, start_date, and start_time must all be provided
	if (
		schedTripDesc.route_id && schedTripDesc.route_id === rtTripDesc.route_id
		&& schedTripDesc.direction_id && schedTripDesc.direction_id === rtTripDesc.direction_id
		&& schedTripDesc.start_date && schedTripDesc.start_date === rtTripDesc.start_date
		&& schedTripDesc.start_time && schedTripDesc.start_time === rtTripDesc.start_time
	) {
		return true
	}
	return false
}

// > Either stop_sequence or stop_id must be provided within a StopTimeUpdate - both fields cannot be empty. stop_sequence is required for trips that visit the same stop_id more than once (e.g., a loop) to disambiguate which stop the prediction is for.
// https://gtfs.org/documentation/realtime/reference/#message-stoptimeupdate
const stopTimeUpdatesMatch = (tripHasFrequencies, schedStopTime, rtStopTimeUpdate) => {
	return (
		Number.isFinite(schedStopTime.stop_sequence) && Number.isFinite(rtStopTimeUpdate.stop_sequence)
			? schedStopTime.stop_sequence === rtStopTimeUpdate.stop_sequence
			: !tripHasFrequencies
	) && (
		schedStopTime.stop_id && rtStopTimeUpdate.stop_id
			? schedStopTime.stop_id === rtStopTimeUpdate.stop_id
			: !tripHasFrequencies
	)
}
{
	const check = (tripHasFrequencies, stop_seq1, stop_seq2, stop_id1, stop_id2, expectedResult) => {
		deepStrictEqual(
			stopTimeUpdatesMatch(
				tripHasFrequencies,
				{stop_sequence: stop_seq1, stop_id: stop_id1},
				{stop_sequence: stop_seq2, stop_id: stop_id2},
			),
			expectedResult,
		)
	}

	{ // no frequencies
		// stop_id & stop_sequence matching
		check(false, 123, 123, 'abc', 'abc', true)
		check(false, null, 123, 'abc', 'abc', true)
		check(false, 123, null, 'abc', 'abc', true)
		check(false, null, null, 'abc', 'abc', true)
		check(false, 123, 123, null, 'abc', true)
		check(false, 123, 123, 'abc', null, true)
		check(false, 123, 123, null, null, true)

		// stop_id mismatch
		check(false, 123, 123, 'abc', 'def', false)
		check(false, null, 123, 'abc', 'def', false)
		check(false, 123, null, 'abc', 'def', false)
		check(false, null, null, 'abc', 'def', false)

		// stop_sequence mismatch
		check(false, 123, 456, 'abc', 'abc', false)
		check(false, 123, 456, null, 'abc', false)
		check(false, 123, 456, 'abc', null, false)
		check(false, 123, 456, null, null, false)

		// stop_id & stop_sequence mismatch
		check(false, 123, 456, 'abc', 'def', false)
		check(false, 123, 456, null, 'def', false)
		check(false, 123, 456, 'abc', null, false)
		check(false, 123, 456, null, null, false)
	}

	{ // with frequencies
		// stop_id & stop_sequence matching
		check(true, 123, 123, 'abc', 'abc', true)
		check(true, null, 123, 'abc', 'abc', false)
		check(true, 123, null, 'abc', 'abc', false)
		check(true, null, null, 'abc', 'abc', false)
		check(true, 123, 123, null, 'abc', false)
		check(true, 123, 123, 'abc', null, false)
		check(true, 123, 123, null, null, false)

		// stop_id mismatch
		check(true, 123, 123, 'abc', 'def', false)
		check(true, null, 123, 'abc', 'def', false)
		check(true, 123, null, 'abc', 'def', false)
		check(true, null, null, 'abc', 'def', false)

		// stop_sequence mismatch
		check(true, 123, 456, 'abc', 'abc', false)
		check(true, 123, 456, null, 'abc', false)
		check(true, 123, 456, 'abc', null, false)
		check(true, 123, 456, null, null, false)

		// stop_id & stop_sequence mismatch
		check(true, 123, 456, 'abc', 'def', false)
		check(true, 123, 456, null, 'def', false)
		check(true, 123, 456, 'abc', null, false)
		check(true, 123, 456, null, null, false)
	}
}

const createDetermineTripsRtCoverage = (cfg) => {
	const {
		gtfsDb,
		timeBufferBefore,
		timeBufferAfter,
		// todo: rename to `matchSTUs`?
		determineSTUCoverage,
	} = cfg
	strictEqual(typeof determineSTUCoverage, 'boolean')

	const logger = createLogger('matching', {
		level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
	})
	const stuLogger = createLogger('matching-stu', {
		level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
	})

	const determineTripsRtCoverage = async (feedMsg) => {
		// todo: modify gtfs-rt-binding's protobuf decoder to parse protobuf properly
		const feedTimestamp = feedMsg.header?.timestamp ? Number(protobufJsLongToBigInt(feedMsg.header?.timestamp)) : null
		const _activeScheduleTripInstances = await queryActiveScheduleTripInstances({
			db: gtfsDb,
			// To compute the RT feeds' Schedule coverage (finding Schedule trip instances which should also be in the RT feed), `FeedHeader.timestamp` seems an appropriate time value to use.
			// However, to match RT feed items with Schedule trip instances, `TripUpdate.timestamp`/`VehiclePosition.timestamp` should be preferred! After all, a GTFS-RT feed might contain of
			// - very up-to-date (as in: recently measured) feed items, as well as
			// - old feed items, much older than `FeedHeader.timestamp - timeBufferBefore`.
			// For the latter, using `FeedHeader.timestamp` to query relevant Schedule trip instance will *not* work.
			// todo: change the matching logic to accept >1 timestamps, query using each feed item's `.timestamp`, falling back to `FeedHeader.timestamp`
			t: Number.isInteger(feedTimestamp) ? feedTimestamp * 1000 : Date.now(),
			timeBufferBefore,
			timeBufferAfter,
			withStopTimes: determineSTUCoverage,
		})
		// [[TripDescriptor], ...]
		let activeSchedTripInstances = _activeScheduleTripInstances.map(tripDesc => [tripDesc])

		// todo: there might be >1 entity child per (unique) TripDescriptor, e.g. 1 TripUpdate & 1 VehiclePosition – support and provide helpful metrics for this!
		// todo: ^ this involves identifying TripDescriptors as equal

		// [[TripDescriptor, FeedEntity child (TripUpdate/VehiclePosition/etc.), child's kind], ...]
		let rtTripInstances = []
		const onRtTripDescriptor = (tripDesc, feedItem, feedItemKind) => {
			const normalizedRtTripDesc = {
				...pick(tripDesc, [
					'route_id',
					'trip_id',
					'start_date',
					'direction_id',
				]),
				start_time: tripDesc.start_time
					? parseTimeAsMilliseconds(tripDesc.start_time)
					: null,
			}
			rtTripInstances.push([
				normalizedRtTripDesc,
				feedItem,
				feedItemKind,
			])
		}
		for (const feedEntity of feedMsg.entity) {
			if (feedEntity.trip_update?.trip) {
				// todo: deduplicate with feedEntity.vehicle.trip (below)?
				onRtTripDescriptor(feedEntity.trip_update.trip, feedEntity.trip_update, KIND_TRIP_UPDATE)
			}
			// > VehiclePosition.trip – […] Can be empty or partial if the vehicle can not be identified with a given trip instance.
			// todo: add metric for vehicles without schedule match
			if (feedEntity.vehicle?.trip) {
				// todo: deduplicate with feedEntity.trip_update.trip (above)?
				onRtTripDescriptor(feedEntity.vehicle.trip, feedEntity.vehicle, KIND_VEHICLE_POSITION)
			}
			// todo: handle feedEntity.alert
			// todo: handle feedEntity.trip_modifications
		}

		const scheduleTripDescsByRtTripDesc = new Map() // rtTripDesc -> schedTripDesc
		const matchedSchedTripInstances = new Set()

		// StopTimeUpdate/stop_time coverage
		const stopTimeUpdateMatchStatusByRtTripDesc = new WeakMap() // rtTripDesc -> STUs index -> boolean
		const stopTimeMatchStatusBySchedTripDesc = new WeakMap() // schedTripDesc -> stop_times index -> boolean

		const remainingRtTripInstances = [...rtTripInstances]
		// todo: improve the current runtime complexity of `sched * rt`, e.g. by using sorted lists
		for (let iRtTripInstance = 0; iRtTripInstance < remainingRtTripInstances.length; iRtTripInstance++) {
			logger.trace({iRtTripInstance}, '--')
			const rtTripInstance = remainingRtTripInstances[iRtTripInstance]
			const [
				rtTripDesc,
				rtFeedItem,
				rtFeedItemKind,
			] = rtTripInstance

			const schedTripInstance = activeSchedTripInstances.find(([schedTripDesc]) => {
				return tripDescriptorsMatch(schedTripDesc, rtTripDesc)
			})
			if (!schedTripInstance) { // no match
				logger.debug({
					rtTripDescriptor: rtTripDesc,
					rtFeedItemKind,
				}, 'no match found or RT TripDescriptor')
				continue
			}
			const [schedTripDesc] = schedTripInstance
			logger.debug({
				rtTripDescriptor: rtTripDesc,
				scheduleTripDescriptor: schedTripDesc,
				rtFeedItemKind,
			}, 'matched RT TripDescriptor')

			scheduleTripDescsByRtTripDesc.set(rtTripDesc, schedTripDesc)
			matchedSchedTripInstances.add(schedTripInstance)
			remainingRtTripInstances.splice(iRtTripInstance, 1) // delete entry
			iRtTripInstance--

			if (determineSTUCoverage && rtFeedItemKind === KIND_TRIP_UPDATE) {
				const rtSTUs = rtFeedItem.stop_time_update
				const tripHasFrequencies = schedTripInstance[0].trip_has_frequencies
				const schedSTs = schedTripInstance[0].stop_sequences.map((stop_sequence, i) => ({
					stop_sequence,
					stop_id: schedTripInstance[0].stop_ids[i],
				}))
				stuLogger.debug({
					rtSTUs,
					schedSTs,
				}, 'matching RT StopTimeUpdates with Schedule stop_times')

				// indices indicate which RT STU, boolean indicates matching status
				const rtSTUsMatchStatus = new Array(rtSTUs.length).fill(false)
				const schedSTsMatchStatus = new Array(schedSTs.length).fill(false)
				stopTimeUpdateMatchStatusByRtTripDesc.set(rtTripDesc, rtSTUsMatchStatus)
				stopTimeMatchStatusBySchedTripDesc.set(schedTripDesc, schedSTsMatchStatus)

				// todo: improve the current runtime complexity of `sched * rt`, e.g. by using sorted lists
				let schedSTsOffset = 0
				for (let iRtSTU = 0; iRtSTU < rtSTUs.length; iRtSTU++) {
					stuLogger.trace({iRtSTU}, '--')
					const rtSTU = rtSTUs[iRtSTU]
					const logCtx = {
						rtTripDescriptor: rtTripDesc,
						tripHasFrequencies,
						iRtSTU,
						schedSTsOffset,
						rtSTUStopSequence: rtSTU.stop_sequence,
						rtSTUStopId: rtSTU.stop_id,
					}

					const _iSchedST = schedSTs.slice(schedSTsOffset).findIndex((schedST) => {
						return stopTimeUpdatesMatch(tripHasFrequencies, schedST, rtSTU)
					})
					if (_iSchedST < 0) { // no match
						stuLogger.debug(logCtx, 'no match found or RT StopTimeUpdate')
						continue
					}
					const iSchedST = logCtx.iSchedST = schedSTsOffset + _iSchedST
					schedSTsOffset = iSchedST + 1

					const schedST = schedSTs[iSchedST]
					logCtx.schedSTStopSequence = schedST.stop_sequence
					logCtx.schedSTStopId = schedST.stop_id
					stuLogger.debug(logCtx, 'matched RT StopTimeUpdate')

					rtSTUsMatchStatus[iRtSTU] = true
					schedSTsMatchStatus[iSchedST] = true
				}
				stuLogger.trace({
					schedSTsOffset,
					nrOfSchedSTs: schedSTs.length,
				}, 'loop done')
			}
		}

		const unmatchedSchedTripInstances = activeSchedTripInstances
		.filter(tripInst => !matchedSchedTripInstances.has(tripInst))
		const unmatchedRtTripInstances = new Set(remainingRtTripInstances)

		for (const schedTripInstance of unmatchedSchedTripInstances) {
			const [schedTripDesc] = schedTripInstance
			const schedSTsMatchStatus = new Array(schedTripInstance[0].stop_sequences).fill(false)
			stopTimeMatchStatusBySchedTripDesc.set(schedTripDesc, schedSTsMatchStatus)
		}

		logger.info({
			feedTimestamp,
			activeSchedTripInstances: activeSchedTripInstances.length,
			rtTripInstances: rtTripInstances.length,
			unmatchedSchedTripInstances: unmatchedSchedTripInstances.size,
			unmatchedRtTripInstances: unmatchedRtTripInstances.size,
		}, 'matching done')
		return {
			scheduleTripDescsByRtTripDesc,
			activeSchedTripInstances,
			rtTripInstances,
			unmatchedRtTripInstances,
			unmatchedSchedTripInstances,
			// empty if `!determineSTUCoverage`
			stopTimeUpdateMatchStatusByRtTripDesc,
			stopTimeMatchStatusBySchedTripDesc,
		}
	}

	return {
		determineTripsRtCoverage,
	}
}

export {
	KIND_TRIP_UPDATE,
	KIND_VEHICLE_POSITION,
	tripDescriptorsMatch,
	createDetermineTripsRtCoverage,
}
