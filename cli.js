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

if ('port' in flags) {
	cfg.port = parseInt(flags.port)
} else if ('PORT' in process.env) {
	cfg.port = parseInt(process.env.PORT)
} else {
	cfg.port = 3000
}

// todo: allow setting additional headers & fetch options

const {
	stop,
} = await serveGtfsRtMetrics(cfg)

withSoftExit(stop)
