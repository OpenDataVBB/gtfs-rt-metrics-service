#!/usr/bin/env node

import {parseArgs} from 'node:util'
import pkg from './package.json' with {type: 'json'}

const {
	positionals: args,
	values: flags,
} = parseArgs({
	options: {
		'help': {
			type: 'boolean',
			short: 'h',
		},
		'version': {
			type: 'boolean',
			short: 'v',
		},
		'port': {
			type: 'string',
			short: 'p',
		},
		'fetch-interval': {
			type: 'string',
			short: 'i',
		},
		'user-agent': {
			type: 'string',
			short: 'a',
		},
		'matching-time-buffer-before': {
			type: 'string',
		},
		'matching-time-buffer-after': {
			type: 'string',
		},
	},
	allowPositionals: true,
})

if (flags.help) {
	process.stdout.write(`
Usage:
    serve-gtfs-rt-from-nats [options] -- <gtfs-rt-url> ...
Options:
    --port                    -p  Port to serve the metrics on.
                                  Default: $PORT, otherwise 3000
    --fetch-interval          -i  How often to fetch the GTFS-RT feed, in seconds.
                                  Default: $GTFS_RT_FETCH_INTERVAL, otherwise 10.
    --user-agent              -a  Which User-Agent header to send when fetching the
                                  feed via HTTP. Default: $USER_AGENT, otherwise
                                  "${pkg.name} \$random".
    --matching-time-buffer-before Match GTFS-RT entities with Schedule trip instances
                                  that have been (or were) active earlier than now,
                                  in seconds.
                                  Default: $GTFS_RT_MATCHING_TIME_BUFFER_BEFORE, otherwise 10m.
    --matching-time-buffer-after  Match GTFS-RT entities with Schedule trip instances
                                  that will be (or are) active later than now,
                                  in seconds.
                                  Default: $GTFS_RT_MATCHING_TIME_BUFFER_AFTER, otherwise 10m.
Examples:
    serve-gtfs-rt-from-nats --port 1234 'https://example.org/gtfs-rt.pb'
\n`)
	process.exit(0)
}

if (flags.version) {
	process.stdout.write(`${pkg.name} v${pkg.version}\n`)
	process.exit(0)
}

import {randomBytes} from 'node:crypto'
import {serveGtfsRtMetrics} from './index.js'
import {withSoftExit} from './lib/soft-exit.js'

const cfg = {
	gtfsRtUrls: [...args],
}
const opt = {}

if ('port' in flags) {
	cfg.port = parseInt(flags.port)
} else if ('PORT' in process.env) {
	cfg.port = parseInt(process.env.PORT)
} else {
	cfg.port = 3000
}

if ('fetch-interval' in flags) {
	cfg.fetchInterval = parseInt(flags['fetch-interval']) * 1000
} else if ('GTFS_RT_FETCH_INTERVAL' in process.env) {
	cfg.fetchInterval = parseInt(process.env.GTFS_RT_FETCH_INTERVAL) * 1000
} else {
	cfg.fetchInterval = 10_000
}

if ('user-agent' in flags) {
	cfg.userAgent = flags['user-agent']
} else if ('USER_AGENT' in process.env) {
	cfg.userAgent = process.env.USER_AGENT
} else {
	cfg.userAgent = `${pkg.name} ${randomBytes(2).toString('hex')}`
}

if ('matching-time-buffer-before' in flags) {
	opt.matchingTimeBufferBefore = parseInt(flags['matching-time-buffer-before']) * 1000
} else if ('GTFS_RT_MATCHING_TIME_BUFFER_BEFORE' in process.env) {
	opt.matchingTimeBufferBefore = parseInt(process.env.GTFS_RT_MATCHING_TIME_BUFFER_BEFORE) * 1000
} else {
	opt.matchingTimeBufferBefore = 600_000 // 10 minutes
}
if ('matching-time-buffer-after' in flags) {
	opt.matchingTimeBufferAfter = parseInt(flags['matching-time-buffer-after']) * 1000
} else if ('GTFS_RT_MATCHING_TIME_BUFFER_AFTER' in process.env) {
	opt.matchingTimeBufferAfter = parseInt(process.env.GTFS_RT_MATCHING_TIME_BUFFER_AFTER) * 1000
} else {
	opt.matchingTimeBufferAfter = 600_000 // 10 minutes
}

// todo: allow setting additional headers & fetch options

const {
	stop,
} = await serveGtfsRtMetrics(cfg, opt)

withSoftExit(stop)
