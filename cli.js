#!/usr/bin/env node

import {parseArgs} from 'node:util'
import pkg from './package.json' with {type: 'json'}

const {
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
	},
	allowPositionals: true,
})

if (flags.help) {
	process.stdout.write(`
Usage:
    serve-gtfs-rt-from-nats [options]
Examples:
    serve-gtfs-rt-from-nats
\n`)
	process.exit(0)
}

if (flags.version) {
	process.stdout.write(`${pkg.name} v${pkg.version}\n`)
	process.exit(0)
}

// todo
