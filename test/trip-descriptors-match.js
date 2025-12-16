import {
	test,
} from 'node:test'
import {
	strictEqual,
} from 'node:assert/strict'
import {
	tripDescriptorsMatch,
} from '../lib/matching.js'

const _baseSchedTripDesc = Object.freeze({
	trip_has_frequencies: false,
	trip_has_only_1_service_date: false,
})

test('matches by trip_id & start_date, with multi-date service', () => {
	const trip_id = 'trip-1️⃣'
	const start_date = '20010203'
	const schedTripDesc = {
		..._baseSchedTripDesc,
		trip_id,
		start_date,
	}

	{
		const rtTripDesc = {
			trip_id,
			start_date,
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), true)
	}

	{ // unequal trip_id
		const rtTripDesc = {
			trip_id: 'trip-2️⃣',
			start_date,
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), false)
	}

	{ // unequal start_date
		const rtTripDesc = {
			trip_id,
			start_date: '20020304',
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), false)
	}

	{ // unequal start_time
		const rtTripDesc = {
			trip_id,
			start_date,
			start_time: '12:13:14',
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), false)
	}
})

test('matches by trip_id only, with single-date service', () => {
	const trip_id = 'trip-1️⃣'
	const schedTripDesc = {
		..._baseSchedTripDesc,
		trip_id,
		trip_has_only_1_service_date: true,
	}

	{
		const rtTripDesc = {
			trip_id,
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), true)
	}

	{ // unequal trip_id
		const rtTripDesc = {
			trip_id: 'trip-2️⃣',
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), false)
	}
})

test('matches by trip_id, start_date & start_time, with frequencies', () => {
	const trip_id = 'trip-1️⃣'
	const start_date = '20010203'
	const start_time = '12:13:14'
	const schedTripDesc = {
		..._baseSchedTripDesc,
		trip_has_frequencies: true,
		trip_id,
		start_date,
		start_time,
	}
	const rtTripDesc = {
		trip_id,
		start_date,
		start_time,
	}

	{
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), true)
	}

	{ // missing Schedule start_time
		const _schedTripDesc = {...schedTripDesc}
		delete _schedTripDesc.start_time
		strictEqual(tripDescriptorsMatch(_schedTripDesc, rtTripDesc), false)
	}
	{ // missing Schedule & RT start_time
		const _schedTripDesc = {...schedTripDesc}
		delete _schedTripDesc.start_time
		const _rtTripDesc = {...rtTripDesc}
		delete _rtTripDesc.start_time
		strictEqual(tripDescriptorsMatch(_schedTripDesc, _rtTripDesc), false)
	}
	{ // unequal start_time
		const rtTripDesc = {
			trip_id,
			start_date,
			start_time: '13:14:15',
		}
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), false)
	}
})

test('matches by route_id, direction_id, start_date & start_time', () => {
	const route_id = 'route-1️⃣'
	const direction_id = 'A'
	const start_date = '20010203'
	const start_time = '12:13:14'
	const schedTripDesc = {
		..._baseSchedTripDesc,
		route_id,
		direction_id,
		start_date,
		start_time,
	}
	const rtTripDesc = {
		route_id,
		direction_id,
		start_date,
		start_time,
	}

	{
		strictEqual(tripDescriptorsMatch(schedTripDesc, rtTripDesc), true)
	}

	{ // unequal route_id
		strictEqual(
			tripDescriptorsMatch(
				schedTripDesc,
				{
					...rtTripDesc,
					route_id: 'route-2️⃣',
				},
			),
			false,
		)
	}
	{ // missing Schedule route_id
		const _schedTripDesc = {...schedTripDesc}
		delete _schedTripDesc.route_id
		strictEqual(tripDescriptorsMatch(_schedTripDesc, rtTripDesc), false)
	}
	{ // missing RT route_id
		const _rtTripDesc = {...rtTripDesc}
		delete _rtTripDesc.route_id
		strictEqual(tripDescriptorsMatch(schedTripDesc, _rtTripDesc), false)
	}

	{ // unequal direction_id
		strictEqual(
			tripDescriptorsMatch(
				schedTripDesc,
				{
					...rtTripDesc,
					direction_id: 'B',
				},
			),
			false,
		)
	}
	{ // missing Schedule direction_id
		const _schedTripDesc = {...schedTripDesc}
		delete _schedTripDesc.direction_id
		strictEqual(tripDescriptorsMatch(_schedTripDesc, rtTripDesc), false)
	}
	{ // missing RT direction_id
		const _rtTripDesc = {...rtTripDesc}
		delete _rtTripDesc.direction_id
		strictEqual(tripDescriptorsMatch(schedTripDesc, _rtTripDesc), false)
	}

	{ // unequal start_date
		strictEqual(
			tripDescriptorsMatch(
				schedTripDesc,
				{
					...rtTripDesc,
					start_date: '20020304',
				},
			),
			false,
		)
	}
	{ // missing Schedule start_date
		const _schedTripDesc = {...schedTripDesc}
		delete _schedTripDesc.start_date
		strictEqual(tripDescriptorsMatch(_schedTripDesc, rtTripDesc), false)
	}
	{ // missing RT start_date
		const _rtTripDesc = {...rtTripDesc}
		delete _rtTripDesc.start_date
		strictEqual(tripDescriptorsMatch(schedTripDesc, _rtTripDesc), false)
	}

	{ // unequal start_time
		strictEqual(
			tripDescriptorsMatch(
				schedTripDesc,
				{
					...rtTripDesc,
					start_time: '13:14:15',
				},
			),
			false,
		)
	}
	{ // missing Schedule start_time
		const _schedTripDesc = {...schedTripDesc}
		delete _schedTripDesc.start_time
		strictEqual(tripDescriptorsMatch(_schedTripDesc, rtTripDesc), false)
	}
	{ // missing RT start_time
		const _rtTripDesc = {...rtTripDesc}
		delete _rtTripDesc.start_time
		strictEqual(tripDescriptorsMatch(schedTripDesc, _rtTripDesc), false)
	}
})
