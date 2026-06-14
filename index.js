import {ok} from 'node:assert'
import {Counter, Summary, Gauge} from 'prom-client'
import {performance} from 'node:perf_hooks'
import {createHash} from 'node:crypto'
import _gtfsRtBindings from 'gtfs-rt-bindings'
const {FeedMessage} = _gtfsRtBindings
import {createLogger} from './lib/logger.js'
import {
	connectToGtfsDb,
} from './lib/gtfs-db.js'
import {
	createDetermineTripsRtCoverage,
	KIND_TRIP_UPDATE,
} from './lib/matching.js'
import {createMetricsServer, registry as metricsRegistry} from './lib/metrics.js'
import {
	isProgrammerError,
	countByLabels,
	protobufJsLongToBigInt,
	normalizeAgencyIdForMetrics as defaultNormalizeAgencyIdForMetrics,
	normalizeRouteIdForMetrics as defaultNormalizeRouteIdForMetrics,
	normalizeRouteTypeForMetrics as defaultNormalizeRouteTypeForMetrics,
} from './lib/util.js'

// > enum Incrementality {
// > 	FULL_DATASET = 0;
// > 	DIFFERENTIAL = 1;
// > }
// https://gtfs.org/documentation/realtime/proto/
const INCREMENTALITY_FULL_DATASET = 0

// > enum ScheduleRelationship {
// > 	// Trip that is running in accordance with its GTFS schedule, or is close
// > 	// enough to the scheduled trip to be associated with it.
// > 	SCHEDULED = 0;
// > 	[…]
// > }
// https://gtfs.org/documentation/realtime/proto/
const TU_SCHEDULE_RELATIONSHIP_SCHEDULED = 0

// > // The relation between the StopTimeEvents and the static schedule.
// > enum ScheduleRelationship {
// > 	// The vehicle is proceeding in accordance with its static schedule of
// > 	// stops, although not necessarily according to the times of the schedule.
// > 	// At least one of arrival and departure must be provided. If the schedule
// > 	// for this stop contains both arrival and departure times then so must
// > 	// this update. Frequency-based trips (GTFS frequencies.txt with exact_times = 0)
// > 	// should not have a SCHEDULED value and should use UNSCHEDULED instead.
// > 	SCHEDULED = 0;
// > }
// https://gtfs.org/documentation/realtime/proto/
const STU_SCHEDULE_RELATIONSHIP_SCHEDULED = 0

const feedSize = new Gauge({
	name: 'gtfs_rt_feed_size_raw_bytes',
	help: 'size of the final GTFS-RT feed (uncompressed)',
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
	],
})
// todo: last-modified timestamp
const fetchTime = new Summary({
	name: 'gtfs_rt_fetch_time_seconds',
	help: 'time needed to fetch the GTFS-RT feed',
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
	],
})
const processingTime = new Summary({
	name: 'gtfs_rt_processing_time_seconds',
	help: 'time needed to process the GTFS-RT feed',
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
	],
})
const feedFetchesTotal = new Counter({
	name: 'gtfs_rt_feed_fetches_total',
	help: 'how often the GTFS-RT feed has been fetched & processed',
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
		'status', // success_changed, success_unchanged, fetch_failure, parse_failure, processing_failure
	],
})

const feedTimestampSeconds = new Gauge({
	name: 'gtfs_rt_feed_timestamp_seconds',
	help: 'GTFS-RT FeedHeader.timestamp, if present',
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
	],
})
const feedEntitiesMetric = new Gauge({
	name: 'gtfs_rt_feed_entities',
	help: 'number of entities in the GTFS-RT feed',
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
	],
})

const rtItemsMetric = new Gauge({
	name: 'gtfs_rt_items',
	help: `number of items (FeedEntity children) in the GTFS-RT feed, by their matching result with the Schedule feed`,
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
		'kind', // tu=TripUpdate, vp=VehiclePosition
		'sched_rel', // TripDescriptor.ScheduleRelationship
		'route_id_n', // normalized route_id
		'matched', // 0 or 1
	],
})
const scheduleTripInstancesMetric = new Gauge({
	name: 'gtfs_rt_schedule_trip_instances',
	help: `number of trip instances in the Schedule feed (within the time buffer), and if they have >=1 corresponding GTFS-RT items`,
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
		'agency_id_n', // normalized agency_id
		'route_type_n', // normalized route_type
		'route_id_n', // normalized route_id
		'matched', // 0 or 1
	],
})

const rtFeedItemsAgesSeconds = new Summary({
	name: 'gtfs_rt_feed_items_ages_seconds',
	help: `age (time until now) of each item (FeedEntity children) in the GTFS-RT feed that has a .timestamp`,
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
		'kind', // tu=TripUpdate, vp=VehiclePosition
		'sched_rel', // TripDescriptor.ScheduleRelationship
		'agency_id_n', // normalized agency_id, only if matched with Schedule trip instance
		'route_type_n', // normalized route_type, only if matched with Schedule trip instance
		'route_id_n', // normalized route_id
		'matched', // 0 or 1
	],
})

// StopTimeUpdate-/stop_time-based metrics
const rtSTUsMetric = new Gauge({
	name: 'gtfs_rt_stoptimeupdates',
	help: `number of StopTimeUpdates (TripUpdate children) in the GTFS-RT feed, by their matching result with the Schedule feed`,
	registers: [metricsRegistry],
	labelNames: [
		// todo: by rt_feed_digest
		'tu_sched_rel', // TripDescriptor.ScheduleRelationship
		// todo: tu_matched?
		'route_id_n', // normalized route_id
		'matched', // 0 or 1
		'sched_rel', // StopTimeUpdate.ScheduleRelationship
	],
})
// const scheduleStopTimesPerTripInstanceMetric = new Summary({
// 	name: 'gtfs_rt_schedule_stoptimes_per_trip_instance',
// 	help: `number of stop_times per trip instance in the Schedule feed, by the trip instance's matching result with the GTFS-RT feed`,
// 	registers: [metricsRegistry],
// 	labelNames: [
// 		// // todo: by rt_feed_digest
// 		'agency_id_n', // normalized agency_id
// 		'route_type_n', // normalized route_type
// 		'route_id_n', // normalized route_id
// 		'matched', // Schedule stop_time matched? – 0 or 1
// 	],
// })
const scheduleStopTimesMetric = new Gauge({
	name: 'gtfs_rt_schedule_stoptimes',
	help: `number of stop_times across all schedule trip instances (within the time buffer) in the Schedule feed, by their matching result with the GTFS-RT feed`,
	registers: [metricsRegistry],
	labelNames: [
		// // todo: by rt_feed_digest
		'agency_id_n', // normalized agency_id
		'route_type_n', // normalized route_type
		'route_id_n', // normalized route_id
		// todo: trip_inst_matched?
		'matched', // Schedule stop_time matched? – 0 or 1
	],
})

const matchingTimeBufferBeforeSeconds = new Gauge({
	name: 'gtfs_rt_matching_time_buffer_before_seconds',
	help: 'Amount of time that Schedule trip instances can be in the past while still being matched with GTFS-RT entities.',
	registers: [metricsRegistry],
})
const matchingTimeBufferAfterSeconds = new Gauge({
	name: 'gtfs_rt_matching_time_buffer_after_seconds',
	help: 'Amount of time that Schedule trip instances can be in the future while still being matched with GTFS-RT entities.',
	registers: [metricsRegistry],
})

class FeedProcessingError extends Error {}

const serveGtfsRtMetrics = async (cfg, opt = {}) => {
	const {
		gtfsRtUrls,
		fetchInterval, // in milliseconds
		userAgent,
		port,
	} = cfg

	ok(Array.isArray(gtfsRtUrls), 'cfg.gtfsRtUrls must be an array')
	if (gtfsRtUrls.length === 0) {
		throw new Error('you must specify at least 1 GTFS-RT-URL')
	}
	for (let i = 0; i < gtfsRtUrls.length; i++) {
		try {
			new URL(gtfsRtUrls[i])
		} catch (err) {
			if (err?.code === 'ERR_INVALID_URL') {
				throw new Error(`"${gtfsRtUrls[i]}" (positional argument ${i}) is not a valid URL`)
			}
			throw err
		}
	}
	// todo: support >1 GTFS-RT URLs
	const [gtfsRtUrl] = gtfsRtUrls

	ok(Number.isInteger(fetchInterval), 'cfg.fetchInterval must be an integer')

	ok(Number.isInteger(port), 'cfg.port must be an integer')

	const {
		pathToGtfsDb,
		matchingTimeBufferBefore, // milliseconds
		matchingTimeBufferAfter, // milliseconds
		normalizeAgencyIdForMetrics,
		normalizeRouteIdForMetrics,
		normalizeRouteTypeForMetrics,
		determineSTUCoverage,
	} = {
		pathToGtfsDb: null, // default: `$GTFS_IMPORTER_DB_PREFIX.gtfs.duckdb`
		matchingTimeBufferBefore: 600_000, // 10 minutes
		matchingTimeBufferAfter: 600_000, // 10 minutes
		// keep cardinality low by normalizing, e.g. truncating, hashing
		// see also https://www.robustperception.io/cardinality-is-key/
		normalizeAgencyIdForMetrics: defaultNormalizeAgencyIdForMetrics,
		normalizeRouteIdForMetrics: defaultNormalizeRouteIdForMetrics,
		normalizeRouteTypeForMetrics: defaultNormalizeRouteTypeForMetrics,
		determineSTUCoverage: false,
		...opt,
	}

	const logger = createLogger('service')
	const feedLogger = createLogger('feed')

	matchingTimeBufferBeforeSeconds.set(matchingTimeBufferBefore / 1000)
	matchingTimeBufferAfterSeconds.set(matchingTimeBufferAfter / 1000)

	let determineTripsRtCoverage

	let pGtfsDb = null
	let gtfsDb = null
	const _reconnectGtfsDb = async () => {
		logger.debug({
			alreadyConnected: Boolean(gtfsDb),
			connecting: pGtfsDb !== null,
		}, 'reconnecting to GTFS Schedule DB')

		if (pGtfsDb) {
			logger.trace('-- waiting for current GTFS Schedule DB connection initiation before reconnecting')
			await pGtfsDb
			await new Promise(resolve => setTimeout(resolve, 1))
		}
		if (gtfsDb) {
			logger.trace('-- disconnecting from current GTFS Schedule DB')
			gtfsDb.db.closeSync()
		}

		logger.trace('-- reconnecting to GTFS Schedule DB')
		try {
			pGtfsDb = connectToGtfsDb({
				pathToDb: pathToGtfsDb,
			})
			gtfsDb = await pGtfsDb
		} finally {
			pGtfsDb = null
		}
		logger.trace('-- successfully reconnected to GTFS Schedule DB')

		const _detCov = createDetermineTripsRtCoverage({
			gtfsDb,
			timeBufferBefore: matchingTimeBufferBefore,
			timeBufferAfter: matchingTimeBufferAfter,
			determineSTUCoverage,
		})
		determineTripsRtCoverage = _detCov.determineTripsRtCoverage
	}
	await _reconnectGtfsDb()

	const processFeedMessage = async (cfg) => {
		const {
			feedMessage: feedMsg,
			tFetch,
		} = cfg

		if (
			feedMsg.header?.gtfs_realtime_version
			&& feedMsg.header?.gtfs_realtime_version !== '2.0'
		) {
			const err = new FeedProcessingError('unsupported FeedHeader.gtfs_realtime_version, must be "2.0"')
			err.actual = feedMsg.header?.gtfs_realtime_version
			err.expected = '2.0'
			throw err
		}
		if (
			Number.isInteger(feedMsg.header?.incrementality)
			&& feedMsg.header?.incrementality !== INCREMENTALITY_FULL_DATASET
		) {
			const err = new FeedProcessingError('unsupported FeedHeader.incrementality, must be 0 (FULL_DATASET)')
			err.actual = feedMsg.header?.incrementality
			err.expected = INCREMENTALITY_FULL_DATASET
			throw err
		}
		if (feedMsg.header?.timestamp) {
			// todo: modify gtfs-rt-binding's protobuf decoder to parse protobuf properly
			const feedTimestamp = Number(protobufJsLongToBigInt(feedMsg.header?.timestamp))
			feedTimestampSeconds.set(feedTimestamp)
		}

		if (!('entity' in feedMsg)) {
			feedEntitiesMetric.set(0)
			return;
		}
		ok(Array.isArray(feedMsg.entity), 'feedMsg.entity must be an array')
		feedEntitiesMetric.set(feedMsg.entity.length)

		const {
			activeSchedTripInstances,
			scheduleTripDescsByRtTripDesc,
			rtTripInstances,
			// unmatchedRtTripInstances,
			unmatchedSchedTripInstances,
			// empty if `!determineSTUCoverage`
			stopTimeUpdateMatchStatusByRtTripDesc,
			stopTimeMatchStatusBySchedTripDesc,
		} = await determineTripsRtCoverage(feedMsg)

		const _getSchedTripInstanceLabels = (rtTripDesc) => {
			let matched = '0'
			let agency_id_n = '?'
			let route_type_n = '?'
			let route_id_n = rtTripDesc.route_id ?? '?'
			if (scheduleTripDescsByRtTripDesc.has(rtTripDesc)) {
				matched = '1'
				const {
					agency_id,
					route_type,
					route_id,
				} = scheduleTripDescsByRtTripDesc.get(rtTripDesc)
				agency_id_n = normalizeAgencyIdForMetrics(agency_id)
				route_type_n = normalizeAgencyIdForMetrics(route_type)
				route_id_n = normalizeRouteIdForMetrics(route_id)
			}
			return {
				matched,
				agency_id_n,
				route_type_n,
				route_id_n,
			}
		}

		const _rtItemsMetricValues = countByLabels(
			[
				'kind', // tu=TripUpdate, vp=VehiclePosition
				'sched_rel', // TripDescriptor.ScheduleRelationship
				'route_id_n', // normalized route_id
				'matched', // 0 or 1
			],
			rtTripInstances.map((tripInstance) => {
				const [tripDesc, feedItem, kind] = tripInstance
				const {
					matched,
					route_id_n,
				} = _getSchedTripInstanceLabels(tripDesc)
				return [
					kind,
					String(feedItem.trip?.schedule_relationship ?? '?'),
					route_id_n,
					matched,
				]
			}),
		)
		for (const [labels, count] of _rtItemsMetricValues) {
			rtItemsMetric.set(labels, count)
		}

		const _scheduleTripInstancesMetricValues = countByLabels(
			[
				'agency_id_n', // normalized agency_id
				'route_type_n', // normalized route_type
				'route_id_n', // normalized route_id
				'matched', // 0 or 1
			],
			activeSchedTripInstances.map((tripInstance) => {
				const [tripDesc] = tripInstance
				const matched = !unmatchedSchedTripInstances.includes(tripInstance)
				const agency_id_n = normalizeAgencyIdForMetrics(tripDesc.agency_id)
				const route_type_n = normalizeRouteTypeForMetrics(tripDesc.route_type)
				const route_id_n = normalizeRouteIdForMetrics(tripDesc.route_id)
				return [
					agency_id_n,
					route_type_n,
					route_id_n,
					matched ? '1' : '0',
				]
			}),
		)
		for (const [labels, count] of _scheduleTripInstancesMetricValues) {
			scheduleTripInstancesMetric.set(labels, count)
		}

		for (const [tripDesc, feedItem, kind] of rtTripInstances.values()) {
			if (!feedItem.timestamp) continue // todo: track these too

			const {
				matched,
				agency_id_n,
				route_type_n,
				route_id_n,
			} = _getSchedTripInstanceLabels(tripDesc)

			const ts = protobufJsLongToBigInt(feedItem.timestamp)
			const age = Number(BigInt(tFetch) - ts * BigInt(1000))
			rtFeedItemsAgesSeconds.observe({
				kind,
				sched_rel: String(feedItem.trip?.schedule_relationship ?? '?'),
				agency_id_n,
				route_type_n,
				route_id_n,
				matched,
			}, age / 1000)
		}

		if (determineSTUCoverage) {
			const _rtSTUsMetricValues = countByLabels(
				[
					'tu_sched_rel', // TripDescriptor.ScheduleRelationship
					'route_id_n', // normalized route_id
					'matched', // 0 or 1
					'sched_rel', // StopTimeUpdate.ScheduleRelationship
				],
				rtTripInstances
				.filter(([_, __, kind]) => kind === KIND_TRIP_UPDATE)
				.filter(([tripDesc]) => stopTimeUpdateMatchStatusByRtTripDesc.has(tripDesc))
				.flatMap((tripInstance) => {
					const [tripDesc, tripUpdate] = tripInstance
					const {
						route_id_n,
					} = _getSchedTripInstanceLabels(tripDesc)

					const stuMatchStatus = stopTimeUpdateMatchStatusByRtTripDesc.get(tripDesc)
					return tripUpdate.stop_time_update.map((stu, i) => [
						String(tripUpdate.schedule_relationship ?? TU_SCHEDULE_RELATIONSHIP_SCHEDULED), // tu_sched_rel
						route_id_n,
						stuMatchStatus[i] ? '1' : '0', // matched
						// > The default relationship is SCHEDULED.
						// https://gtfs.org/documentation/realtime/reference/#message-stoptimeupdate
						String(stu.schedule_relationship ?? STU_SCHEDULE_RELATIONSHIP_SCHEDULED), // sched_rel
					])
				}),
			)
			for (const [labels, count] of _rtSTUsMetricValues) {
				rtSTUsMetric.set(labels, count)
			}

			const _schedSTsMetricValues = countByLabels(
				[
					'agency_id_n', // normalized agency_id
					'route_type_n', // normalized route_type
					'route_id_n', // normalized route_id
					'matched', // Schedule stop_time matched? – 0 or 1
				],
				activeSchedTripInstances
				.flatMap((tripInstance) => {
					const [tripDesc] = tripInstance

					const stMatchStatus = stopTimeMatchStatusBySchedTripDesc.get(tripDesc)
					ok(Array.isArray(stMatchStatus, `${JSON.stringify(tripDesc)} has no stop_times match status`))
					return tripDesc.stop_sequences.map((_, i) => [
						normalizeAgencyIdForMetrics(tripDesc.agency_id), // agency_id_n
						normalizeRouteTypeForMetrics(tripDesc.route_type), // route_type_n
						normalizeRouteIdForMetrics(tripDesc.route_id), // route_id_n
						stMatchStatus[i] ? '1' : '0', // matched
					])
				}),
			)
			for (const [labels, count] of _schedSTsMetricValues) {
				scheduleStopTimesMetric.set(labels, count)
			}
		}
	}

	let prevEtagOrBodyHash = null
	const fetchAndProcessFeed = async () => {
		const tFetch = Date.now()
		logger.debug({
			tFetch,
		}, 'fetching and processing GTFS-RT feed')

		let metricsStatus = null
		try {
			const tFetchBegin = performance.now()
			const res = await fetch(gtfsRtUrl, {
				headers: {
					'user-agent': userAgent,
					// todo: implement https://gist.github.com/derhuerst/f0b6c9cf28b90746770464eb8e5b918f?
					accept: 'application/protobuf',

					// todo: implement proper caching using If-Modified-Since & If-None-Match!
				},
				keepalive: true,
			})
			if (!res.ok) {
				metricsStatus = 'fetch_failure'
				const err = new Error(`GTFS-RT server responded non-ok (${res.status})`)
				err.url = gtfsRtUrl
				err.resonse = res
				throw err
			}
			if (res.headers.etag && res.headers === prevEtagOrBodyHash) {
				metricsStatus = 'success_unchanged'
				logger.debug({
					etagOrBodyHash,
				}, 'feed is unchanged (same ETag), not processing further')
				return;
			}
			let feed
			try {
				feed = Buffer.from(await res.arrayBuffer())
			} finally {
				metricsStatus = 'fetch_failure'
			}

			fetchTime.observe((performance.now() - tFetchBegin) / 1000)
			feedSize.set(feed.length)

			const tProcessingBegin = performance.now()

			const etagOrBodyHash = (
				res.headers.etag
				|| createHash('sha1').update(feed).digest('hex')
			)
			const feedHasChanged = etagOrBodyHash !== prevEtagOrBodyHash
			prevEtagOrBodyHash = etagOrBodyHash
			if (!feedHasChanged) {
				metricsStatus = 'success_unchanged'
				logger.debug({
					etagOrBodyHash,
				}, 'feed is unchanged (equal body), not processing further')
				return;
			}

			let feedMessage
			try {
				// todo: decode uint64 into BigInt instead of weird custom `Long`s
				feedMessage = FeedMessage.toObject(FeedMessage.decode(feed))
			} catch (err) {
				err.metricsStatus = 'parse_failure'
				throw err
			}
			
			try {
				await processFeedMessage({
					feedMessage,
					tFetch,
				})
			} catch (err) {
				metricsStatus = 'processing_failure'
				if (err instanceof FeedProcessingError) {
					feedLogger.warn(err)
				}
				throw err
			}

			processingTime.observe((performance.now() - tProcessingBegin) / 1000)
			metricsStatus = 'success_changed'
		} catch (err) {
			// Some fetch API errors are TypeErrors, but we don't want to throw them.
			if (
				isProgrammerError(err)
				// fetch errors
				&& !(err instanceof TypeError && err.code === 'ENOENT')
				&& !(err instanceof TypeError && err.code === 'ECONNREFUSED')
				&& !(err instanceof TypeError && err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT')
				&& !(err instanceof TypeError && err.cause?.code === 'UND_ERR_BODY_TIMEOUT')
			) {
				throw err
			}
			logger.warn({
				err,
			}, 'failed to process the fetched GTFS-RT feed')
		} finally {
			feedFetchesTotal.inc({
				status: metricsStatus,
			})
		}
	}

	const _fetchAndProcessLoop = async () => {
		const t0 = performance.now()

		// This is async and the main logic, so we must catch all errors because they'd crash the process otherwise.
		try {
			await fetchAndProcessFeed()
		} finally {
			const againIn = Math.max(
				fetchInterval / 10,
				fetchInterval - (performance.now() - t0)
			)
			fetchTimer = setTimeout(_fetchAndProcessLoop, againIn)
		}
	}
	// prevent DOSing due to endless crash loops, but fetch sooner than `fetchInterval`
	let fetchTimer = setTimeout(_fetchAndProcessLoop, fetchInterval / 10)
	const fetchFeedNow = () => {
		clearTimeout(fetchTimer)
		fetchTimer = setTimeout(_fetchAndProcessLoop, 1)
	}

	const reconnectGtfsDbAndFetchAgain = async () => {
		logger.info('received SIGHUP, reconnecting to GTFS Schedule DB, then fetching GTFS-RT again')
		try {
			await _reconnectGtfsDb()
			fetchFeedNow()
		} catch (err) {
			logger.error({
				err,
			}, 'failed to reconnect to the GTFS Schedule DB')
		}
	}
	process.on('SIGHUP', reconnectGtfsDbAndFetchAgain)

	const metricsServer = createMetricsServer({
		serverPort: port,
		checkHealth: async () => {
			await gtfsDb.get('SELECT 1')
		},
	})
	await metricsServer.start()
	logger.info({
		...metricsServer.address(),
	}, `serving Prometheus metrics on port ${metricsServer.address().port}`)

	const stop = async () => {
		clearTimeout(fetchTimer)
		metricsServer.close()
	}

	return {
		fetchAndProcessFeed,
		stop,
		metricsRegistry,
	}
}

export {
	serveGtfsRtMetrics,
}
