import {
	test,
} from 'node:test'
import {
	ok,
	deepStrictEqual,
} from 'node:assert/strict'
import {
	connectToTestGtfsDb,
} from './lib.js'
import {
	createDetermineTripsRtCoverage,
} from '../lib/matching.js'
import feedMsg1 from './fixtures/flix-2026-01-09T00-35-05+01-00.gtfs-rt.js'
import {
	stuSchedRelSkipped1,
} from './fixtures/flix-N1153-stu-sched-rel.gtfs-rt.js'

const VEHICLE_POSITION = 'vp'
const TRIP_UPDATE = 'tu'

const gtfsDb = await connectToTestGtfsDb('flix-2026-01-04.gtfs.duckdb')
const {
	determineTripsRtCoverage,
} = createDetermineTripsRtCoverage({
	gtfsDb,
	timeBufferBefore: 30 * 60 * 1000, // 30 minutes
	timeBufferAfter: 30 * 60 * 1000, // 30 minutes
	determineSTUCoverage: false,
})

test('correctly matches Flix 1 TripUpdate & 1 VehiclePosition with the same trip_id', async () => {
	const n1153TripId = 'N1153-1-0255012026-DO#AOS-00'

	const {
		activeSchedTripInstances,
		rtTripInstances,
		unmatchedRtTripInstances: _unmatchedRtTripInstances,
		unmatchedSchedTripInstances: _unmatchedSchedTripInstances,
	} = await determineTripsRtCoverage(feedMsg1)
	const unmatchedRtTripInstances = Array.from(_unmatchedRtTripInstances).toSorted()
	const unmatchedSchedTripInstances = Array.from(_unmatchedSchedTripInstances).toSorted()

	const n1153SchedEntry = activeSchedTripInstances.find(([{trip_id}]) => trip_id === n1153TripId)
	deepStrictEqual(
		unmatchedSchedTripInstances,
		activeSchedTripInstances
		.filter(e => e !== n1153SchedEntry),
	)

	const n1153RtTripInstances = rtTripInstances
	.filter(([tripDesc]) => tripDesc.trip_id === n1153TripId)
	const n1153VpRtEntry = n1153RtTripInstances.find(([{trip_id}, __, feedItemKind]) => trip_id === n1153TripId && feedItemKind === VEHICLE_POSITION)
	const n1153TuRtEntry = n1153RtTripInstances.find(([{trip_id}, __, feedItemKind]) => trip_id === n1153TripId && feedItemKind === TRIP_UPDATE)
	deepStrictEqual(
		unmatchedRtTripInstances,
		rtTripInstances
		.filter(e => ![
			n1153TuRtEntry,
			n1153VpRtEntry,
		].includes(e)),
	)
})

test('correctly computes skipped StopTimeUpdates', async () => {
	const {
		determineTripsRtCoverage: determineTripsRtCoverageWithSTUs,
	} = createDetermineTripsRtCoverage({
		gtfsDb,
		// todo: set to 0?
		timeBufferBefore: 30 * 60 * 1000, // 30 minutes
		timeBufferAfter: 30 * 60 * 1000, // 30 minutes
		determineSTUCoverage: true,
	})

	const n1153FeedEntity = stuSchedRelSkipped1.entity.find(e => e.id === 'N1153-stu-sched-rel-skipped-1')
	ok(n1153FeedEntity, 'precondition failed')
	const n1153TripId = n1153FeedEntity.trip_update.trip.trip_id
	ok(n1153TripId, 'precondition failed')
	const n1153StartDate = n1153FeedEntity.trip_update.trip.start_date
	ok(n1153StartDate, 'precondition failed')

	const {
		scheduleTripDescsByRtTripDesc,
		rtTripInstances,
		stopTimeUpdateMatchStatusByRtTripDesc,
		stopTimeMatchStatusBySchedTripDesc,
	} = await determineTripsRtCoverageWithSTUs(stuSchedRelSkipped1)

	const n1153RtTripDesc = rtTripInstances.find(([rtTripDesc]) => {
		return rtTripDesc.trip_id === n1153TripId && rtTripDesc.start_date === n1153StartDate
	})?.[0]
	const rtSTUsMatchStatus = stopTimeUpdateMatchStatusByRtTripDesc.get(n1153RtTripDesc)
	deepStrictEqual(
		rtSTUsMatchStatus,
		[
			true,
			true,
		],
		`RT StopTimeUpdates' match status with Schedule data is wrong`,
	)

	const n1153SchedTripDesc = scheduleTripDescsByRtTripDesc.get(n1153RtTripDesc)
	const schedSTsMatchStatus = stopTimeMatchStatusBySchedTripDesc.get(n1153SchedTripDesc)
	deepStrictEqual(
		schedSTsMatchStatus,
		[
			false,
			false,
			true, // stop_sequence 3
			false,
			false,
			false,
			false,
			false,
			false,
			true,  // stop_sequence 10
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
		],
		`Schedule stop_times' match status with RT data is wrong`,
	)
})
