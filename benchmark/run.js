#!/usr/bin/env node

// copied & adapted from https://github.com/public-transport/gtfs-via-duckdb/blob/5.0.0/benchmark/index.cjs

import {Bench as Benchmark} from 'tinybench'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
	connectToGtfsDb,
} from '../lib/gtfs-db.js'
import {
	createDetermineTripsRtCoverage,
} from '../lib/matching.js'
import feedMsg1 from '../test/fixtures/flix-2026-01-09T00-35-05+01-00.gtfs-rt.js'

const quantile = (sorted, q) => {
	const pos = (sorted.length - 1) * q
	const base = Math.floor(pos)
	const rest = pos - base
	if (base + 1 < sorted.length) {
		return sorted[base] + rest * (sorted[base + 1] - sorted[base])
	} else {
		return sorted[base]
	}
}

const gtfsDb = await connectToGtfsDb({
	pathToDb: dirname(dirname(fileURLToPath(import.meta.url))) + '/test/fixtures/flix-2026-01-04.gtfs.duckdb',
})

const benchmark = new Benchmark({
	time: 10000, // 10s
	retainSamples: true, // retain task.result.latency.samples
})

benchmark.addEventListener('error', (ev) => {
	console.error(ev.task.result.error)
	process.exit(1)
})

benchmark.addEventListener('cycle', (ev) => {
	const {task} = ev
	if ('error' in task.result) {
		console.error(task.result)
		process.exit(1)
	}
	const samples = Array.from(task.result.latency.samples).sort()
	console.log(JSON.stringify({
		name: task.name,
		avg: task.result.latency.mean,
		min: task.result.latency.min,
		p25: quantile(samples, .25),
		p50: task.result.latency.p50,
		p75: task.result.latency.p75,
		p95: quantile(samples, .95),
		p99: task.result.latency.p99,
		max: task.result.latency.max,
		iterations: task.result.latency.samplesCount,
	}))

	console.error(task.name, '✔︎')
})

// ---

{
	const {
		determineTripsRtCoverage: determineTripsRtCoverage3m,
	} = createDetermineTripsRtCoverage({
		gtfsDb,
		timeBufferBefore: 3 * 60 * 1000, // 3 minutes
		timeBufferAfter: 3 * 60 * 1000, // 3 minutes
		determineSTUCoverage: false,
	})

	benchmark.add('determineTripsRtCoverage with 3m time buffer & FLIX 2026-01-09 GTFS-RT', async () => {
		await determineTripsRtCoverage3m(feedMsg1)
	})
}

{
	const {
		determineTripsRtCoverage: determineTripsRtCoverage30m,
	} = createDetermineTripsRtCoverage({
		gtfsDb,
		timeBufferBefore: 30 * 60 * 1000, // 30 minutes
		timeBufferAfter: 30 * 60 * 1000, // 30 minutes
		determineSTUCoverage: false,
	})

	benchmark.add('determineTripsRtCoverage with 30m time buffer & FLIX 2026-01-09 GTFS-RT', async () => {
		await determineTripsRtCoverage30m(feedMsg1)
	})
}

{
	const {
		determineTripsRtCoverage: determineTripsRtCoverage30mSTU,
	} = createDetermineTripsRtCoverage({
		gtfsDb,
		timeBufferBefore: 30 * 60 * 1000, // 30 minutes
		timeBufferAfter: 30 * 60 * 1000, // 30 minutes
		determineSTUCoverage: true,
	})

	benchmark.add('determineTripsRtCoverage with 30m time buffer, STU coverage & FLIX 2026-01-09 GTFS-RT', async () => {
		await determineTripsRtCoverage30mSTU(feedMsg1)
	})
}

// ---

await benchmark.run()
