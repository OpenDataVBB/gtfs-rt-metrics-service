import {
	deepStrictEqual,
} from 'node:assert/strict'
import sortBy from 'lodash/sortBy.js'
import {fileURLToPath} from 'node:url'
import {dirname} from 'node:path'
import {
	connectToGtfsDb,
} from '../lib/gtfs-db.js'

const sortKeys = (obj) => {
	return Object.fromEntries(
		Object.keys(obj)
		.toSorted()
		.map(key => [key, obj[key]]),
	)
}
deepStrictEqual(
	sortKeys({matched: '1', kind: 'vp', sched_rel: '0'}),
	{kind: 'vp', matched: '1', sched_rel: '0'},
)
const deepStrictEqualMetricValues = (actualVals, expectedVals, ...args) => {
	deepStrictEqual(
		sortBy(actualVals, val => JSON.stringify(sortKeys(val.labels))),
		sortBy(expectedVals, val => JSON.stringify(sortKeys(val.labels))),
		...args
	)
}

const getPathToTestGtfsDb = (dbName) => {
	return dirname(fileURLToPath(import.meta.url)) + '/fixtures/' + dbName
}

const connectToTestGtfsDb = async (dbName) => {
	return await connectToGtfsDb({
		pathToDb: getPathToTestGtfsDb(dbName),
	})
}

export {
	deepStrictEqualMetricValues,
	getPathToTestGtfsDb,
	connectToTestGtfsDb,
}
