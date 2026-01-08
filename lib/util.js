import {deepStrictEqual} from 'node:assert'
import {toBigInt as _protobufJsLongToBigInt} from 'longfn'
// todo: use sth leaner, gtfs-utils brings in too many dependencies
import {
	extendedToBasic as extendedToBasicRouteType,
} from 'gtfs-utils/route-types.js'

// selected from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects#error_objects
const PROGRAMMER_ERRORS = [
	RangeError,
	ReferenceError,
	SyntaxError,
	TypeError,
	URIError,
]
const isProgrammerError = (err) => {
	// todo: use `PROGRAMMER_ERRORS.includes(err.__proto__.constructor)`?
	return PROGRAMMER_ERRORS.some(Err => err instanceof Err)
}

// todo: let gtfs-rt-bindings decode protobuf properly, instead of parsing protobuf (u)int64 into BigInts here
const protobufJsLongToBigInt = (val) => {
	if (typeof val === 'bigint') return val
	return _protobufJsLongToBigInt(val)
}

// We cannot use lodash's countBy() with a concatenated string because we want to obtain the labels by splitting the key.
const countByLabels = (labels, items) => {
	const valsByKey = new Map()
	const countsByKey = new Map()
	for (const vals of items) {
		const key = vals.join(':')

		if (!valsByKey.has(key)) {
			valsByKey.set(key, vals)
		}
		countsByKey.set(
			key,
			countsByKey.has(key)
				? countsByKey.get(key) + 1
				: 1,
		)
	}

	return countsByKey
	.entries()
	.map(([key, count]) => {
		const vals = valsByKey.get(key)
		return [
			Object.fromEntries(vals.map((val, i) => [labels[i], val])),
			count,
		]
	})
}
deepStrictEqual(
	Array.from(countByLabels(
		['foo', 'bar'], // labels
		new Set([
			['1', 'a'],
			['2', 'b'],
			['1', 'b'],
			['2', 'b'],
		]),
	)),
	[
		[{foo: '1', bar: 'a'}, 1],
		[{foo: '2', bar: 'b'}, 2],
		[{foo: '1', bar: 'b'}, 1],
	],
)

const normalizeAgencyIdForMetrics = (agency_id) => {
	return agency_id === null ? '?' : agency_id.slice(0, 3)
}
const normalizeRouteIdForMetrics = (route_id) => {
	return route_id === null ? '?' : route_id.slice(0, 5)
}
const normalizeRouteTypeForMetrics = (route_type) => {
	if (route_type === null) {
		return '?'
	}
	try {
		const _rt = extendedToBasicRouteType(route_type)
		if (_rt !== null) {
			route_type = _rt
		}
	// eslint-disable-next-line no-unused-vars,no-empty
	} catch (_) {}
	return String(route_type)
}

export {
	PROGRAMMER_ERRORS,
	isProgrammerError,
	protobufJsLongToBigInt,
	countByLabels,
	normalizeAgencyIdForMetrics,
	normalizeRouteIdForMetrics,
	normalizeRouteTypeForMetrics,
}
