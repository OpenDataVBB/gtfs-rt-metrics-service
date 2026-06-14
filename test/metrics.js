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
import {
	stuSchedRelSkipped1,
} from './fixtures/flix-N1153-stu-sched-rel.gtfs-rt.js'

const encodeGtfsRtFeedMsg = (feedMsg) => {
	FeedMessage.verify(feedMsg)
	return FeedMessage.encode(feedMsg).finish()
}

const serveGtfsRTAndFetchMetrics = async (cfg) => {
	const {
		feedBuf,
		serveGtfsRtMetricsOpts,
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
			metricsRegistry,
		} = await serveGtfsRtMetrics({
			gtfsRtUrls: [
				`http://localhost:${gtfsRtPort}/`,
			],
			fetchInterval: 3_000, // in milliseconds
			userAgent: 'testing',
			port: metricsPort,
		}, {
			pathToGtfsDb: getPathToTestGtfsDb('flix-2026-01-04.gtfs.duckdb'),
			...serveGtfsRtMetricsOpts,
		})
		stopMetricsServer = _stopMetricsServer

		await fetchAndProcessFeed()
		// We don't even use the metrics HTTP server
		return await metricsRegistry.getMetricsAsJSON()
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
		serveGtfsRtMetricsOpts: {},
	})

	// Should be matched:
	// - Both entities `N1153-1-0255012026-DO#AOS-00-position` & `N1153-1-0255012026-DO#AOS-00-stoptimes`'s feed items.
	// Should *not* be matched:
	// Although entity `2686-1-1400112025-BUF#6MT-00-stoptimes`'s timestamp is 2026-01-09T00:34:18+01:00, its trip_update has a start_date of 2025-11-26, which is far outside `FeedHeader.timestamp - matchingTimeBufferBefore`.
	// - Entity `N885-2-0300012026-AMD#ZAG-00-position`'s trip_id `N885-2-0300012026-AMD#ZAG-00` does not exist in the Schedule data.
	// Additional Schedule trip instances without RT coverage:
	// - trip_id `1922-5-0145012026-BM#BDX-00`, start_date 2026-01-08

	const gtfs_rt_items = metrics.find(m => m.name === 'gtfs_rt_items')
	deepStrictEqualMetricValues(gtfs_rt_items?.values, [
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

	const gtfs_rt_schedule_trip_instances = metrics.find(m => m.name === 'gtfs_rt_schedule_trip_instances')
	deepStrictEqualMetricValues(gtfs_rt_schedule_trip_instances?.values, [
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

test('correctly represents matched/unmatched & skipped StopTimeUpdates in metrics', async () => {
	const metrics = await serveGtfsRTAndFetchMetrics({
		feedBuf: encodeGtfsRtFeedMsg(stuSchedRelSkipped1),
		serveGtfsRtMetricsOpts: {
			determineSTUCoverage: true,
		},
	})

	// Should be matched:
	// - 2 StopTimeUpdates in feed entity `N1153-stu-sched-rel-skipped-1`'s TripUpdate:
	//  	- 1st STU: stop_sequence = 3, schedule_relationship = 1/SKIPPED
	//  	- 2nd STU: stop_sequence = 10, schedule_relationship = 1/SKIPPED
	// Should *not* be matched:
	// - 23 stop_times of Schedule trip instance trip_id = N1153-1-0255012026-DO#AOS-00, date = 2026-01-08:
	//  	- 2 STs with stop_sequence = 1 & stop_sequence = 2
	//  	- 6 STs from stop_sequence = 4 until stop_sequence = 9
	//  	- 17 STs from stop_sequence = 11 until stop_sequence = 27
	// - All 33 stop_times of Schedule trip instance trip_id = 1922-5-0145012026-BM#BDX-00, date = 2026-01-08

	const gtfs_rt_stoptimeupdates = metrics.find(m => m.name === 'gtfs_rt_stoptimeupdates')
	deepStrictEqualMetricValues(gtfs_rt_stoptimeupdates?.values, [
		{
			labels: {tu_sched_rel: '0', route_id_n: 'N1153', matched: '1', 'sched_rel': '1'},
			value: 2,
		},
	])

	const gtfs_rt_schedule_stoptimes = metrics.find(m => m.name === 'gtfs_rt_schedule_stoptimes')
	deepStrictEqualMetricValues(gtfs_rt_schedule_stoptimes?.values, [
		{
			labels: {agency_id_n: 'FLI', route_type_n: '3', route_id_n: 'N1153', matched: '1'},
			value: 2,
		},
		{
			labels: {agency_id_n: 'FLI', route_type_n: '3', route_id_n: 'N1153', matched: '0'},
			value: 2 + 6 + 17,
		},
		{
			labels: {agency_id_n: 'FLI', route_type_n: '3', route_id_n: '1922', matched: '0'},
			value: 33,
		},
	])
})
