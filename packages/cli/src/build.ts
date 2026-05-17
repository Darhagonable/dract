/**
 * Build — Main entry point
 *
 * Orchestrates the packaging pipeline:
 * 1. Scan input directory, classify files
 * 2. Generate .d.ts files (via dartsxToTsx + tsc)
 * 3. Process each file:
 *    - DarTsx .tsx → copy as-is (consumer compiles)
 *    - .ts → transpile to .js (strip types)
 *    - .tsx (non-DarTsx) → transpile to .jsx
 *    - everything else → copy
 * 4. Rewrite import paths (.ts → .js, etc.)
 * 5. Validate package.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import colors from 'kleur';
import { copy, mkdirp, rimraf, write } from './filesystem.js';
import { rewriteImportExtensions } from './imports.js';
import { scan, analyze } from './scan.js';
import { emit_dts, transpile_ts } from './typescript.js';
import { validate } from './validate.js';
import type { PackageOptions, PackageFile } from './types.js';

export async function build(options: PackageOptions): Promise<void> {
	const input = path.resolve(options.cwd, options.input);
	const output = path.resolve(options.cwd, options.output);

	if (!fs.existsSync(input)) {
		throw new Error(`Input directory does not exist: ${path.relative(options.cwd, input)}`);
	}

	console.log(colors.cyan(`Packaging ${path.relative(options.cwd, input)}...`));

	const files = scan(input);
	const dartsxFileNames = new Set(
		files.filter((f) => f.isDartsx).map((f) => f.name),
	);
	const allFileNames = new Set(files.map((f) => f.name));

	// Step 1: Generate .d.ts files
	if (options.types) {
		console.log(colors.dim('  Generating type declarations...'));
		await emit_dts(input, output, options.cwd, files, options.tsconfig);
	}

	// Step 2: Process each file
	for (const file of files) {
		await processFile(input, output, file, dartsxFileNames, allFileNames, options);
	}

	// Step 3: Validate
	const warnings = validate(options.cwd, dartsxFileNames.size > 0);
	if (warnings.length) {
		console.log(colors.bold().yellow('\ndartsx-cli found the following issues:'));
		for (const warning of warnings) {
			console.log(colors.yellow(`  ⚠ ${warning}`));
		}
	}

	console.log(
		colors.bold().green(
			`\n${path.relative(options.cwd, input)} → ${path.relative(options.cwd, output)}`,
		),
	);

	const stats = {
		dartsx: files.filter((f) => f.isDartsx).length,
		transpiled: files.filter((f) => !f.isDartsx && !f.isDeclaration && (f.name.endsWith('.ts') || f.name.endsWith('.tsx'))).length,
		copied: files.filter((f) => !f.isDartsx && !f.name.endsWith('.ts') && !f.name.endsWith('.tsx')).length,
	};

	console.log(colors.dim(
		`  ${stats.dartsx} DarTsx files (shipped as source)` +
		`  ${stats.transpiled} transpiled` +
		`  ${stats.copied} copied`,
	));
}

export async function watch(options: PackageOptions): Promise<void> {
	// Initial build
	await build(options);

	const input = path.resolve(options.cwd, options.input);
	const output = path.resolve(options.cwd, options.output);

	console.log(colors.cyan(`\nWatching ${path.relative(options.cwd, input)} for changes...\n`));

	const { default: chokidar } = await import('chokidar');
	const watcher = chokidar.watch(input, { ignoreInitial: true });

	let timeout: ReturnType<typeof setTimeout>;

	watcher.on('all', (type, filepath) => {
		clearTimeout(timeout);
		timeout = setTimeout(async () => {
			const relPath = path.relative(input, filepath);
			if (type === 'unlink') {
				// Remove corresponding output files
				const file = analyze(relPath, input);
				const destPath = path.join(output, file.dest);
				if (fs.existsSync(destPath)) {
					fs.unlinkSync(destPath);
					console.log(colors.red(`  Removed ${file.dest}`));
				}
				return;
			}

			if (type === 'add' || type === 'change') {
				console.log(colors.dim(`  Processing ${relPath}...`));
				try {
					const files = scan(input);
					const dartsxFileNames = new Set(
						files.filter((f) => f.isDartsx).map((f) => f.name),
					);
					const allFileNames = new Set(files.map((f) => f.name));
					const file = analyze(relPath, input);
					await processFile(input, output, file, dartsxFileNames, allFileNames, options);

					if (options.types) {
						await emit_dts(input, output, options.cwd, files, options.tsconfig);
						console.log(colors.dim('  Updated .d.ts files'));
					}
				} catch (e) {
					console.error(e);
				}
			}
		}, 100);
	});
}

async function processFile(
	input: string,
	output: string,
	file: PackageFile,
	dartsxFileNames: Set<string>,
	allFileNames: Set<string>,
	options: PackageOptions,
): Promise<void> {
	const srcPath = path.join(input, file.name);
	const destPath = path.join(output, file.dest);

	// DarTsx .tsx files → copy with import rewriting (consumer's vite-plugin compiles them)
	if (file.isDartsx) {
		let contents = fs.readFileSync(srcPath, 'utf-8');
		contents = rewriteImportExtensions(contents, dartsxFileNames, file.name, allFileNames);
		write(destPath, contents);
		return;
	}

	// Declaration files → copy as-is
	if (file.isDeclaration) {
		copy(srcPath, destPath);
		return;
	}

	// TypeScript / TSX → transpile
	if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
		let contents = fs.readFileSync(srcPath, 'utf-8');

		// Rewrite import extensions before transpiling
		contents = rewriteImportExtensions(contents, dartsxFileNames, file.name, allFileNames);

		// Transpile (strip types)
		contents = await transpile_ts(contents, srcPath, options.tsconfig, options.cwd);

		write(destPath, contents);
		return;
	}

	// JavaScript files → rewrite imports only
	if (file.name.endsWith('.js') || file.name.endsWith('.jsx')) {
		let contents = fs.readFileSync(srcPath, 'utf-8');
		contents = rewriteImportExtensions(contents, dartsxFileNames, file.name, allFileNames);
		write(destPath, contents);
		return;
	}

	// Everything else → copy
	copy(srcPath, destPath);
}
