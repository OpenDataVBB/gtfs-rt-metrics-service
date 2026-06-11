import _gtfsRtBindings from 'gtfs-rt-bindings'
const {FeedMessage} = _gtfsRtBindings
import {createServer} from 'node:http'
import {promisify} from 'node:util'
import {
	test,
} from 'node:test'
import {
	serveGtfsRtMetrics,
} from '../index.js'
import {
	getPathToTestGtfsDb,
	deepStrictEqualMetricValues,
} from './lib.js'
import feedMsgFlix20260109 from './fixtures/flix-2026-01-09T00-35-05+01-00.gtfs-rt.js'

const encodeGtfsRtFeedMsg = (feedMsg) => {
	FeedMessage.verify(feedMsg)
	return FeedMessage.encode(feedMsg).finish()
}

const serveGtfsRTAndFetchMetrics = async (cfg) => {
	const {
		feedBuf,
	} = cfg

	const gtfsRtPort = Math.round(30_000 + Math.random() * 9999)
	const metricsPort = Math.round(30_000 + Math.random() * 9999)

	const gtfsRtServer = createServer((req, res) => {
		res.setHeader('Content-Type', 'application/protobuf')
		res.end(feedBuf)
	})
	await promisify(gtfsRtServer.listen.bind(gtfsRtServer))(gtfsRtPort, 'localhost')
	const stopGtfsRtServer = promisify(gtfsRtServer.close.bind(gtfsRtServer))

	let stopMetricsServer = async () => {}
	try {
		const {
			stop: _stopMetricsServer,
			fetchAndProcessFeed,
			metricsRegister,
		} = await serveGtfsRtMetrics({
			gtfsRtUrls: [
				`http://localhost:${gtfsRtPort}/`,
			],
			fetchInterval: 3_000, // in milliseconds
			userAgent: 'testing',
			port: metricsPort,
		}, {
			pathToGtfsDb: getPathToTestGtfsDb('flix-2026-01-04.gtfs.duckdb'),
		})
		stopMetricsServer = _stopMetricsServer

		await fetchAndProcessFeed()
		// We don't even use the metrics HTTP server
		return await metricsRegister.getMetricsAsJSON()
	} finally {
		await Promise.all([
			stopGtfsRtServer(),
			stopMetricsServer()
		])
	}
}

test('correctly represents sample Flix 2026-01-09 GTFS-RT FeedMessage in metrics', async () => {
	const metrics = await serveGtfsRTAndFetchMetrics({
		feedBuf: encodeGtfsRtFeedMsg(feedMsgFlix20260109),
	})

	// Should be matched:
	// - Both entities `N1153-1-0255012026-DO#AOS-00-position` & `N1153-1-0255012026-DO#AOS-00-stoptimes`'s feed items.
	// Should *not* be matched:
	// Although entity `2686-1-1400112025-BUF#6MT-00-stoptimes`'s timestamp is 2026-01-09T00:34:18+01:00, its trip_update has a start_date of 2025-11-26, which is far outside `FeedHeader.timestamp - matchingTimeBufferBefore`.
	// - Entity `N885-2-0300012026-AMD#ZAG-00-position`'s trip_id `N885-2-0300012026-AMD#ZAG-00` does not exist in the Schedule data.
	// Additional Schedule trip instances without RT coverage:
	// - trip_id `1922-5-0145012026-BM#BDX-00`, start_date 2026-01-08

	const gtfs_rt_items_total = metrics.find(m => m.name === 'gtfs_rt_items_total')
	deepStrictEqualMetricValues(gtfs_rt_items_total?.values, [
		// matched
		{ // entity `N1153-1-0255012026-DO#AOS-00-position`
			labels: {kind: 'vp', sched_rel: '0', matched: '1', route_id_n: 'N1153'},
			value: 1,
		},
		{ // entity `N1153-1-0255012026-DO#AOS-00-stoptimes`
			labels: {kind: 'tu', sched_rel: '0', matched: '1', route_id_n: 'N1153'},
			value: 1,
		},
		// unmatched
		{ // entity `2686-1-1400112025-BUF#6MT-00-stoptimes`
			labels: {kind: 'tu', sched_rel: '0', matched: '0', route_id_n: '?'},
			value: 1,
		},
		{ // entity `N885-2-0300012026-AMD#ZAG-00-position`
			labels: {kind: 'vp', sched_rel: '0', matched: '0', route_id_n: '?'},
			value: 1,
		},
	])

	const gtfs_rt_schedule_trip_instances_total = metrics.find(m => m.name === 'gtfs_rt_schedule_trip_instances_total')
	deepStrictEqualMetricValues(gtfs_rt_schedule_trip_instances_total?.values, [
		// matched:
		// - trip_id `N1153-1-0255012026-DO#AOS-00`
		{
			labels: {agency_id_n: 'FLI', route_type_n: '3', route_id_n: 'N1153', matched: '1'},
			value: 1,
		},
		// unmatched
		// - trip_id `1922-5-0145012026-BM#BDX-00`
		{
			labels: {agency_id_n: 'FLI', route_type_n: '3', route_id_n: '1922', matched: '0'},
			value: 1,
		},
	])
})
