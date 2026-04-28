#!/usr/bin/env node

const command = process.argv[2];

if (!command || command === '--help' || command === '-h') {
	console.log(`
  dartsx — DarTsx CLI

  Commands:
    package    Package a DarTsx library for npm distribution

  Usage:
    dartsx package [options]
    dartsx --help
`);
	process.exit(0);
}

if (command === 'package') {
	const { build, watch } = await import('dartsx-package');

	const args = process.argv.slice(3);
	const cwd = process.cwd();

	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
  dartsx package — Package DarTsx libraries for npm distribution

  Usage:
    dartsx package [options]

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
		input: getFlag(args, '--input', '-i') ?? 'src',
		output: getFlag(args, '--output', '-o') ?? 'dist',
		types: !args.includes('--no-types'),
		tsconfig: getFlag(args, '--tsconfig'),
	};

	if (args.includes('-w') || args.includes('--watch')) {
		await watch(options);
	} else {
		await build(options);
	}
} else {
	console.error(`Unknown command: ${command}\nRun "dartsx --help" for usage.`);
	process.exit(1);
}

function getFlag(argv, long, short) {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === long || (short && argv[i] === short)) {
			return argv[i + 1];
		}
	}
	return undefined;
}
