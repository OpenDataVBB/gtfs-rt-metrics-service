import {fileURLToPath} from 'node:url'
import {dirname} from 'node:path'
import {
	test,
} from 'node:test'
import {
	deepStrictEqual,
} from 'node:assert/strict'
import {
	connectToGtfsDb,
} from '../lib/gtfs-db.js'
import {
	createDetermineTripsRtCoverage,
} from '../lib/matching.js'
import feedMsg1 from './fixtures/flix-2026-01-09T00-35-05+01-00.gtfs-rt.js'

const VEHICLE_POSITION = 'vp'
const TRIP_UPDATE = 'tu'

const gtfsDb = await connectToGtfsDb({
	pathToDb: dirname(fileURLToPath(import.meta.url)) + '/fixtures/flix-2026-01-04.gtfs.duckdb',
})
const {
	determineTripsRtCoverage,
} = createDetermineTripsRtCoverage({
	gtfsDb,
	timeBufferBefore: 30 * 60 * 1000, // 30 minutes
	timeBufferAfter: 30 * 60 * 1000, // 30 minutes
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
