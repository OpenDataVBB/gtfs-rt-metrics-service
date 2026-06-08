import {fileURLToPath} from 'node:url'
import {dirname} from 'node:path'
import {
	connectToGtfsDb,
} from '../lib/gtfs-db.js'

const getPathToTestGtfsDb = (dbName) => {
	return dirname(fileURLToPath(import.meta.url)) + '/fixtures/' + dbName
}

const connectToTestGtfsDb = async (dbName) => {
	return await connectToGtfsDb({
		pathToDb: getPathToTestGtfsDb(dbName),
	})
}

export {
	getPathToTestGtfsDb,
	connectToTestGtfsDb,
}
