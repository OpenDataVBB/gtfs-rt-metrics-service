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

const createDetermineTripsRtCoverage = (cfg) => {
	const {
		gtfsDb,
		timeBufferBefore,
		timeBufferAfter,
	} = cfg

	const logger = createLogger('matching', {
		level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
	})

	const determineTripsRtCoverage = async (feedMsg) => {
		// todo: modify gtfs-rt-binding's protobuf decoder to parse protobuf properly
		const feedTimestamp = feedMsg.header?.timestamp ? Number(protobufJsLongToBigInt(feedMsg.header?.timestamp)) : null
		const _activeScheduleTripInstances = await queryActiveScheduleTripInstances({
			db: gtfsDb,
			t: Number.isInteger(feedTimestamp) ? feedTimestamp * 1000 : Date.now(),
			timeBufferBefore,
			timeBufferAfter,
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
		const remainingRtTripInstances = [...rtTripInstances]
		// todo: improve the current runtime complexity of `sched * rt`, e.g. by using sorted lists
		for (let iRtTripInstance = 0; iRtTripInstance < remainingRtTripInstances.length; iRtTripInstance++) {
			logger.trace({iRtTripInstance}, '--')
			const rtTripInstance = remainingRtTripInstances[iRtTripInstance]
			const [
				rtTripDesc,
				// eslint-disable-next-line no-unused-vars
				_,
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
		}

		const unmatchedSchedTripInstances = activeSchedTripInstances
		.filter(tripInst => !matchedSchedTripInstances.has(tripInst))
		const unmatchedRtTripInstances = new Set(remainingRtTripInstances)
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
