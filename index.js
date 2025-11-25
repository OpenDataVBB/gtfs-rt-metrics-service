import {ok} from 'node:assert'
import {Counter, Summary, Gauge} from 'prom-client'
import {performance} from 'node:perf_hooks'
import _gtfsRtBindings from 'gtfs-rt-bindings'
const {FeedMessage} = _gtfsRtBindings
import {createLogger} from './lib/logger.js'
import {createMetricsServer, register as metricsRegister} from './lib/metrics.js'
import {
	isProgrammerError,
	protobufJsLongToBigInt,
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

	const logger = createLogger('service')
	const feedLogger = createLogger('feed')

	const feedSize = new Gauge({
		name: 'feed_size_raw_bytes',
		help: 'size of the final GTFS-RT feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	// todo: last-modified timestamp
	const fetchTime = new Summary({
		name: 'fetch_time_seconds',
		help: 'time needed to fetch the GTFS-RT feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const processingTime = new Summary({
		name: 'processing_time_seconds',
		help: 'time needed to process the fetched GTFS-RT feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const feedFetchesTotal = new Counter({
		name: 'feed_fetches_total',
		help: 'how often the GTFS-RT feed has been fetched',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
			'status', // success, fetch_failure, parse_failure, processing_failure
		],
	})

	const feedTimestampSeconds = new Gauge({
		name: 'feed_timestamp_seconds',
		help: 'FeedHeader.timestamp, if present',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})
	const feedEntitiesTotal = new Gauge({
		name: 'feed_entities_total',
		help: 'number of entities in the feed',
		registers: [metricsRegister],
		labelNames: [
			// todo: by rt_feed_digest
		],
	})

	const processFeedMessage = (cfg) => {
		const {
			feedMessage: feedMsg,
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
	}

	const fetchAndProcessFeed = async () => {
		let metricsStatus = null
		try {
			const tFetchBegin = performance.now()
			const res = await fetch(gtfsRtUrl, {
				headers: {
					'user-agent': userAgent,
					// todo: implement https://gist.github.com/derhuerst/f0b6c9cf28b90746770464eb8e5b918f?
					accept: 'application/protobuf',
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
			let feed
			try {
				feed = Buffer.from(await res.arrayBuffer())
			} finally {
				metricsStatus = 'fetch_failure'
			}

			fetchTime.observe((performance.now() - tFetchBegin) / 1000)
			feedSize.set(feed.length)

			const tProcessingBegin = performance.now()

			let feedMessage
			try {
				// todo: decode uint64 into BigInt instead of weird custom `Long`s
				feedMessage = FeedMessage.toObject(FeedMessage.decode(feed))
			} catch (err) {
				err.metricsStatus = 'parse_failure'
				throw err
			}
			
			try {
				processFeedMessage({
					feedMessage,
				})
			} catch (err) {
				metricsStatus = 'processing_failure'
				if (err instanceof FeedProcessingError) {
					feedLogger.warn(err)
				}
				throw err
			}

			processingTime.observe((performance.now() - tProcessingBegin) / 1000)
			metricsStatus = 'success'
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

	const fetchInterval = 10_000 // todo: make customisable
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
