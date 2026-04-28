#!/usr/bin/env node

import { build, watch } from '../dist/index.js';
import * as path from 'node:path';

const args = process.argv.slice(2);
const cwd = process.cwd();

const flags = {
	watch: args.includes('-w') || args.includes('--watch'),
	input: getFlag(args, '--input', '-i') ?? 'src',
	output: getFlag(args, '--output', '-o') ?? 'dist',
	types: !args.includes('--no-types'),
	tsconfig: getFlag(args, '--tsconfig'),
};

if (args.includes('--help') || args.includes('-h')) {
	console.log(`
  dartsx-package — Package DarTsx libraries for npm distribution

  Usage:
    dartsx-package [options]

  Options:
    -i, --input <dir>    Input directory (default: src)
    -o, --output <dir>   Output directory (default: dist)
    -w, --watch          Watch for changes
    --no-types           Skip .d.ts generation
    --tsconfig <path>    Path to tsconfig.json
    -h, --help           Show this help
`);
	process.exit(0);
}

const options = {
	cwd,
	input: flags.input,
	output: flags.output,
	types: flags.types,
	tsconfig: flags.tsconfig,
};

if (flags.watch) {
	await watch(options);
} else {
	await build(options);
}

/** @param {string[]} argv */
function getFlag(argv, long, short) {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long || (short && argv[i] === short)) {
			return argv[i + 1];
		}
	}
	return undefined;
}
