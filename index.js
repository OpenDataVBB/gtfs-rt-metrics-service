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
} from './lib/matching.js'
import {createMetricsServer, register as metricsRegister} from './lib/metrics.js'
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
		matchingTimeBufferBefore, // milliseconds
		matchingTimeBufferAfter, // milliseconds
		normalizeAgencyIdForMetrics,
		normalizeRouteIdForMetrics,
		normalizeRouteTypeForMetrics,
	} = {
		matchingTimeBufferBefore: 600_000, // 10 minutes
		matchingTimeBufferAfter: 600_000, // 10 minutes
		// keep cardinality low by normalizing, e.g. truncating, hashing
		// see also https://www.robustperception.io/cardinality-is-key/
		normalizeAgencyIdForMetrics: defaultNormalizeAgencyIdForMetrics,
		normalizeRouteIdForMetrics: defaultNormalizeRouteIdForMetrics,
		normalizeRouteTypeForMetrics: defaultNormalizeRouteTypeForMetrics,
		...opt,
	}

	const logger = createLogger('service')
	const feedLogger = createLogger('feed')

	const feedSize = new Gauge({
		name: 'gtfs_rt_feed_size_raw_bytes',
		help: 'size of the final GTFS-RT feed (uncompressed)',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	// todo: last-modified timestamp
	const fetchTime = new Summary({
		name: 'gtfs_rt_fetch_time_seconds',
		help: 'time needed to fetch the GTFS-RT feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const processingTime = new Summary({
		name: 'gtfs_rt_processing_time_seconds',
		help: 'time needed to process the GTFS-RT feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const feedFetchesTotal = new Counter({
		name: 'gtfs_rt_feed_fetches_total',
		help: 'how often the GTFS-RT feed has been fetched & processed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
			'status', // success_changed, success_unchanged, fetch_failure, parse_failure, processing_failure
		],
	})

	const feedTimestampSeconds = new Gauge({
		name: 'gtfs_rt_feed_timestamp_seconds',
		help: 'GTFS-RT FeedHeader.timestamp, if present',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const feedEntitiesTotal = new Gauge({
		name: 'gtfs_rt_feed_entities_total',
		help: 'number of entities in the GTFS-RT feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const activeScheduleTripInstancesTotal = new Gauge({
		name: 'gtfs_rt_active_schedule_trip_instances_total',
		help: 'number of active trip instances in the GTFS Schedule feed within the matching time period (see matching_time_buffer_before/matching_time_buffer_after)',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})

	const unmatchedRtItemsTotal = new Gauge({
		name: 'gtfs_rt_unmatched_rt_items_total',
		help: `number of items (FeedEntity children) in the GTFS-RT feed that can't be matched with the Schedule feed`,
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
			'kind', // tu=TripUpdate, vp=VehiclePosition
			'route_id_n', // normalized route_id
		],
	})
	const unmatchedScheduleTripInstancesTotal = new Gauge({
		name: 'gtfs_rt_unmatched_schedule_trip_instances_total',
		help: `number of trip instances in the Schedule feed that don't have a corresponding GTFS-RT item`,
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
			'agency_id_n', // normalized agency_id
			'route_type_n', // normalized route_type
			'route_id_n', // normalized route_id
		],
	})

	const rtFeedItemsAgesSeconds = new Summary({
		name: 'gtfs_rt_feed_items_ages_seconds',
		help: `age (time until now) of each item (FeedEntity children) in the GTFS-RT feed that has a .timestamp`,
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
			'kind', // tu=TripUpdate, vp=VehiclePosition
			'agency_id_n', // normalized agency_id, only if matched with Schedule trip instance
			'route_type_n', // normalized route_type, only if matched with Schedule trip instance
			'route_id_n', // normalized route_id
		],
	})

	const matchingTimeBufferBeforeSeconds = new Gauge({
		name: 'gtfs_rt_matching_time_buffer_before_seconds',
		help: 'Amount of time that Schedule trip instances can be in the past while still being matched with GTFS-RT entities.',
		registers: [metricsRegister],
	})
	matchingTimeBufferBeforeSeconds.set(matchingTimeBufferBefore / 1000)
	const matchingTimeBufferAfterSeconds = new Gauge({
		name: 'gtfs_rt_matching_time_buffer_after_seconds',
		help: 'Amount of time that Schedule trip instances can be in the future while still being matched with GTFS-RT entities.',
		registers: [metricsRegister],
	})
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
			pGtfsDb = connectToGtfsDb()
			gtfsDb = await pGtfsDb
		} finally {
			pGtfsDb = null
		}
		logger.trace('-- successfully reconnected to GTFS Schedule DB')

		const _detCov = createDetermineTripsRtCoverage({
			gtfsDb,
			timeBufferBefore: matchingTimeBufferBefore,
			timeBufferAfter: matchingTimeBufferAfter,
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
			feedEntitiesTotal.set(0)
		}
		ok(Array.isArray(feedMsg.entity), 'feedMsg.entity must be an array')
		feedEntitiesTotal.set(feedMsg.entity.length)

		const {
			nrOfActiveScheduleTripInstances,
			scheduleTripDescsByRtTripDesc,
			rtTripInstances,
			unmatchedRtTripInstances,
			unmatchedSchedTripInstances,
		} = await determineTripsRtCoverage(feedMsg)

		const _getSchedTripInstanceLabels = (rtTripDesc) => {
			let agency_id_n = '?'
			let route_type_n = '?'
			if (scheduleTripDescsByRtTripDesc.has(rtTripDesc)) {
				const {
					agency_id,
					route_type,
				} = scheduleTripDescsByRtTripDesc.get(rtTripDesc)
				agency_id_n = normalizeAgencyIdForMetrics(agency_id)
				route_type_n = normalizeAgencyIdForMetrics(route_type)
			}
			return {
				agency_id_n,
				route_type_n,
			}
		}

		activeScheduleTripInstancesTotal.set(nrOfActiveScheduleTripInstances)

		const _unmatchedRt = countByLabels(
			[
				'kind', // tu=TripUpdate, vp=VehiclePosition
				'route_id_n', // normalized route_id
			],
			unmatchedRtTripInstances.values().map(([tripDesc, _, kind]) => {
				const route_id_n = normalizeRouteIdForMetrics(tripDesc.route_id)
				return [
					kind,
					route_id_n,
				]
			}),
		)
		for (const [labels, count] of _unmatchedRt) {
			unmatchedRtItemsTotal.set(labels, count)
		}

		const _unmatchedSched = countByLabels(
			[
				'agency_id_n', // normalized agency_id
				'route_type_n', // normalized route_type
				'route_id_n', // normalized route_id
			],
			unmatchedSchedTripInstances.values().map(([tripDesc, _, kind]) => {
				const agency_id_n = normalizeAgencyIdForMetrics(tripDesc.agency_id)
				const route_type_n = normalizeRouteTypeForMetrics(tripDesc.route_type)
				const route_id_n = normalizeRouteIdForMetrics(tripDesc.route_id)
				return [
					agency_id_n,
					route_type_n,
					route_id_n,
				]
			}),
		)
		for (const [labels, count] of _unmatchedSched) {
			unmatchedScheduleTripInstancesTotal.set(labels, count)
		}

		for (const [tripDesc, feedItem, kind] of rtTripInstances.values()) {
			if (!feedItem.timestamp) continue // todo: track these too

			const {
				agency_id_n,
				route_type_n,
			} = _getSchedTripInstanceLabels(tripDesc)
			const route_id_n = normalizeRouteIdForMetrics(tripDesc.route_id)

			const ts = protobufJsLongToBigInt(feedItem.timestamp)
			const age = Number(BigInt(tFetch) - ts * BigInt(1000))
			rtFeedItemsAgesSeconds.observe({
				kind,
				agency_id_n,
				route_type_n,
				route_id_n,
			}, age / 1000)
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
			if (isProgrammerError(err)) {
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
		stop,
	}
}

export {
	serveGtfsRtMetrics,
}
