/**
 * TypeScript integration
 *
 * - emit_dts: Generate .d.ts files for all source files.
 *   For DarTsx files, first transforms them via dartsxToTsx so tsc can understand them.
 * - transpile_ts: Strip types from a .ts file → .js using ts.transpileModule.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { preprocess } from 'dartsx/compiler/preprocess';
import { mkdirp, posixify, rimraf, walk, write } from './filesystem.js';
import type { PackageFile } from './types.js';

/**
 * Generate .d.ts files for all source files.
 *
 * For DarTsx .tsx files, we first transform them to valid TSX via dartsxToTsx,
 * write them to a temp directory, run tsc --emitDeclarationOnly, then copy
 * the generated .d.ts files to the output.
 */
export async function emit_dts(
	input: string,
	output: string,
	cwd: string,
	files: PackageFile[],
	tsconfigPath: string | undefined,
): Promise<void> {
	const ts = await loadTS();
	const tmp = path.join(cwd, 'node_modules', '.dartsx-cli-types');
	rimraf(tmp);
	mkdirp(tmp);

	// Copy all source files to temp, transforming DarTsx files to valid TSX
	for (const file of files) {
		const srcPath = path.join(input, file.name);
		const tmpPath = path.join(tmp, file.name);
		mkdirp(path.dirname(tmpPath));

		if (file.isDartsx) {
			// Transform DarTsx → valid TSX for tsc
			const source = fs.readFileSync(srcPath, 'utf-8');
			const { code } = preprocess(source, { mode: 'typecheck' });
			fs.writeFileSync(tmpPath, code);
		} else {
			fs.copyFileSync(srcPath, tmpPath);
		}
	}

	// Build a tsconfig for declaration emission
	const configPath = tsconfigPath
		? path.resolve(cwd, tsconfigPath)
		: ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');

	let compilerOptions: import('typescript').CompilerOptions = {
		declaration: true,
		emitDeclarationOnly: true,
		declarationMap: true,
		outDir: output,
		rootDir: tmp,
		skipLibCheck: true,
		jsx: ts.JsxEmit.Preserve,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		target: ts.ScriptTarget.ESNext,
		strict: true,
		isolatedModules: true,
	};

	if (configPath) {
		const { error, config } = ts.readConfigFile(configPath, ts.sys.readFile);
		if (!error && config) {
			config.include = [];
			config.files = [];
			const { options } = ts.parseJsonConfigFileContent(
				config,
				ts.sys,
				path.dirname(configPath),
				{},
				configPath,
			);
			compilerOptions = {
				...options,
				declaration: true,
				emitDeclarationOnly: true,
				declarationMap: true,
				outDir: output,
				rootDir: tmp,
				skipLibCheck: true,
			};
		}
	}

	// Collect all files in temp dir
	const inputFiles = walk(tmp)
		.map((f) => posixify(f))
		.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

	const host = ts.createCompilerHost(compilerOptions);
	const program = ts.createProgram(inputFiles, compilerOptions, host);
	const result = program.emit();

	// Report errors but don't fail — some DarTsx transforms may produce minor issues
	const diagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
	if (diagnostics.length > 0) {
		const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCurrentDirectory: () => cwd,
			getCanonicalFileName: (f) => f,
			getNewLine: () => '\n',
		});
		// Only warn, don't fail
		process.stderr.write(formatted);
	}

	// Fix declarationMap source paths to point back to original source files
	// (the d.ts.map files reference the temp dir, but we want them to point to src/)
	const dtsMapFiles = walk(output).filter((f) => f.endsWith('.d.ts.map'));
	const inputRel = posixify(path.relative(cwd, input));
	const tmpRel = posixify(path.relative(cwd, tmp));

	for (const mapFile of dtsMapFiles) {
		const content = fs.readFileSync(mapFile, 'utf-8');
		const parsed = JSON.parse(content);
		if (parsed.sources) {
			parsed.sources = parsed.sources.map((source: string) => {
				// Rewrite paths from temp dir to original source
				const normalized = posixify(source);
				return normalized.replace(tmpRel, inputRel);
			});
			fs.writeFileSync(mapFile, JSON.stringify(parsed));
		}
	}

	rimraf(tmp);
}

/**
 * Transpile a single .ts/.tsx file → .js by stripping types.
 */
export async function transpile_ts(
	source: string,
	filename: string,
	tsconfigPath: string | undefined,
	cwd: string,
): Promise<string> {
	const ts = await loadTS();

	let compilerOptions: import('typescript').CompilerOptions = {
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		target: ts.ScriptTarget.ESNext,
		jsx: ts.JsxEmit.Preserve,
		isolatedModules: true,
	};

	if (tsconfigPath) {
		const configPath = path.resolve(cwd, tsconfigPath);
		const { error, config } = ts.readConfigFile(configPath, ts.sys.readFile);
		if (!error && config) {
			config.include = [];
			config.files = [];
			const { options } = ts.parseJsonConfigFileContent(
				config,
				ts.sys,
				path.dirname(configPath),
				{ sourceMap: false },
				configPath,
			);
			compilerOptions = {
				...options,
				module: ts.ModuleKind.ESNext,
				moduleResolution: ts.ModuleResolutionKind.Bundler,
			};
		}
	}

	return ts.transpileModule(source, {
		compilerOptions,
		fileName: filename,
	}).outputText;
}

async function loadTS(): Promise<typeof import('typescript')> {
	try {
		return (await import('typescript')).default;
	} catch {
		throw new Error(
			'TypeScript is required for dartsx-cli. Install it as a dev dependency.',
		);
	}
}
