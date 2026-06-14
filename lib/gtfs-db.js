import {join as pathJoin, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DuckDBInstance} from '@duckdb/node-api'
import {ok, strictEqual} from 'node:assert/strict'
import {createLogger} from './logger.js'

const logger = createLogger('gtfs-db')

const PATH_TO_DEFAULT_DB = pathJoin(
	// project dir
	dirname(dirname(fileURLToPath(import.meta.url))),
	'gtfs',
	// We mirror duckdb-gtfs-importer here.
	// https://github.com/OpenDataVBB/duckdb-gtfs-importer/blob/4946ce6675fcbcd1b2c75f3090f8f66472694b07/Taskfile.yml#L14
	`${process.env.GTFS_IMPORTER_DB_PREFIX || 'gtfs'}.gtfs.duckdb`
)
logger.trace({
	path: PATH_TO_DEFAULT_DB,
}, 'path to default GTFS DB')

const connectToGtfsDb = async (opt = {}) => {
	const pathToDb = opt.pathToDb ?? PATH_TO_DEFAULT_DB

	const instance = await DuckDBInstance.create(pathToDb)
	const db = await instance.connect()

	const run = async (query, ...args) => {
		logger.trace({
			query,
			args,
		}, 'db run()')
		try {
			return await db.run(query, ...args)
		} catch (err) {
			err.query = query
			err.args = args
			throw err
		}
	}
	const get = async (query, ...args) => {
		logger.trace({
			query,
			args,
		}, 'db run()')
		try {
			const result = await db.runAndReadAll(query, ...args)
			return result.getRowObjects()
		} catch (err) {
			err.query = query
			err.args = args
			throw err
		}
	}

	return {
		run,
		get,
		db,
	}
}

const queryActiveTripInstances = async (cfg) => {
	const {
		db,
		t,
		timeBufferBefore, // milliseconds
		timeBufferAfter, // milliseconds
		withStopTimes,
	} = cfg
	ok(db, 'missing cfg.db')
	ok(Number.isInteger(t), 't must be a UNIX epoch, in milliseconds')
	ok(Number.isInteger(timeBufferBefore), 'timeBufferBefore must be an integer')
	ok(Number.isInteger(timeBufferAfter), 'timeBufferAfter must be an integer')
	strictEqual(typeof withStopTimes, 'boolean', 'withStopTimes must be a boolean')

	const tripInstances = await db.get(`\
		SELECT
			first(active.agency_id) AS agency_id,
			first(active.route_id) AS route_id,
			first(active.route_type) AS route_type,
			first(active.trip_id) AS trip_id,
			-- GTFS-RT format:
			-- > The start date of this trip instance in YYYYMMDD format. […]
			-- – https://gtfs.org/documentation/realtime/reference/#message-tripdescriptor
			replace(first("date"::DATE)::TEXT, '-', '') AS start_date,
			epoch(first(active.trip_start_time))::INTEGER AS start_time,
			first(direction_id) AS direction_id,
			first(trip_has_frequencies) AS trip_has_frequencies,
			first(trip_has_only_1_service_date) AS trip_has_only_1_service_date
${withStopTimes ? `\
			, list(stop_sequence ORDER BY stop_sequence_consec ASC) AS stop_sequences
			, list(stop_id ORDER BY stop_sequence_consec ASC) AS stop_ids
` : ``}
		FROM trips_active_periods_by_date active
${withStopTimes ? `\
		JOIN stop_times st ON active.trip_id = st.trip_id
` : ``}
		WHERE t_active_from <= $1
		AND t_active_until >= $2
		-- todo: filter by date?
		GROUP BY active.trip_id, date, frequencies_row, frequencies_it
		-- todo: ORDER BY
	`, [
		// We query trips that start before `t + timeBufferAfter` and end after `t - timeBufferBefore`.
		// If timeBufferBefore & timeBufferAfter are both 0, we query only trips currently at `t`.
		new Date(t + timeBufferAfter).toISOString(),
		new Date(t - timeBufferBefore).toISOString(),
	])
	if (withStopTimes) {
		for (const tripInstance of tripInstances) {
			tripInstance.stop_sequences = tripInstance.stop_sequences.items
			tripInstance.stop_ids = tripInstance.stop_ids.items
		}
	}
	return tripInstances
}

export {
	connectToGtfsDb,
	queryActiveTripInstances,
}
