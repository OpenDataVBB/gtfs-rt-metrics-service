import {join as pathJoin, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DuckDBInstance} from '@duckdb/node-api'
import {ok} from 'node:assert/strict'
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
	const {
		pathToDb,
	} = {
		pathToDb: PATH_TO_DEFAULT_DB,
		...opt,
	}

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

const queryActiveTrips = async (cfg) => {
	const {
		db,
		t,
	} = cfg
	ok(db, 'missing cfg.db')
	ok(Number.isInteger(t), 't must be a UNIX epoch, in milliseconds')

	return await db.get(`\
		SELECT
			route_id,
			trip_id,
			-- GTFS-RT format:
			-- > The start date of this trip instance in YYYYMMDD format. […]
			-- – https://gtfs.org/documentation/realtime/reference/#message-tripdescriptor
			replace(("date"::DATE)::TEXT, '-', '') AS start_date,
			epoch(trip_start_time)::INTEGER AS start_time,
			direction_id,
			trip_has_frequencies,
			trip_has_only_1_service_date
		FROM trips_active_periods_by_date
		WHERE t_active_from <= $1
		AND t_active_until >= $1
		-- todo: filter by date?
		-- todo: ORDER BY
	`, [
		new Date(t).toISOString(),
	])
}

export {
	connectToGtfsDb,
	queryActiveTrips,
}
