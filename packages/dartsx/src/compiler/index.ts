/**
 * DarTsx Compiler
 *
 * Pipeline: preprocess → oxc-transform (strip TS) → parse (OXC) → analyze → transform
 *
 * The pipeline is split into two entry points so the ProjectCompiler can
 * stabilize the cross-file graph on analysis metadata ALONE and only then run
 * code generation:
 *
 *   analyzeSource(source, options) → CompileAnalysis   (parse + analyze)
 *   generateOutput(analysis, css)  → CompileResult     (transform + print)
 *
 * `compile()` is the convenience single-pass form of both.
 */
import { preprocess, type PreprocessResult } from './phases/1-preprocess';
import { parse } from './phases/2-parse';
import { analyze as analyzeAst, type AnalysisResult } from './phases/3-analyze';
import { transform } from './phases/4-transform';
import { transformSync as oxcTransformSync, type SourceMap as OxcSourceMap } from 'oxc-transform';
import remapping, { type SourceMap } from '@jridgewell/remapping';
import { ProjectCompiler, type ModuleOutput, type ProjectCompilerOptions, type ProjectUpdate } from './project';

export { ProjectCompiler };
export type { ModuleOutput, ProjectCompilerOptions, ProjectUpdate };

// Preprocess is re-exported as part of the compiler entry's public face.
// The dedicated `dartsx/compiler/preprocess` subpath stays for tooling that
// wants the preprocessor alone. Note: `preprocess`/`PreprocessResult` are
// imported above, which would hide them from a bare `export *`, so re-export
// them explicitly.
export { preprocess } from './phases/1-preprocess';
export type { PreprocessResult } from './phases/1-preprocess';

export interface CompileResult {
	/** The compiled JavaScript and its source map. */
	js: {
		/** The generated code */
		code: string;
		/** Source map from output positions to original source positions */
		map: SourceMap;
	};
	/** The compiled CSS, from the source style blocks. */
	css: {
		/** The generated code */
		code: string;
		/** Source map from CSS output positions to source positions (not built yet). */
		map: SourceMap | null;
	};
	/** Metadata about the compiled module. */
	metadata: {
		/** Names of exported state/derived variables (for cross-file reactivity) */
		reactiveExports: string[];
		/**
		 * Cross-file reactive function calls detected at call sites.
		 * Maps import specifier → { exportedName → reactive param indices }.
		 */
		reactiveCalls: Record<string, Record<string, number[]>>;
		/** Import specifiers found in this module (for Vite plugin resolution, avoids regex) */
		importSpecifiers: string[];
	};
	/** The exact program that was printed as the emitted module. */
	ast: unknown;
}

export interface CompileOptions {
	/** Filename (used for error messages and source maps) */
	filename?: string;
	/**
	 * CSS delivery mode.
	 * - `'injected'`: emit `$.style()` calls in JS (styles bundled in JS)
	 * - `'external'`: omit `$.style()` calls, collect CSS for external delivery
	 * Default: `'injected'`
	 */
	css?: 'injected' | 'external';
	/**
	 * Cross-file reactive imports.
	 * Maps import specifiers (e.g., './store') to arrays of reactive variable names.
	 */
	reactiveImports?: Record<string, string[]>;
	/**
	 * Cross-file reactive function param info.
	 * Maps exported function names to arrays of reactive param indices.
	 */
	reactiveCallImports?: Record<string, number[]>;
}

/**
 * A module that has been parsed and analyzed but not yet generated — the
 * unit the project layer reconciles its graph on. Code generation (`generate`)
 * is deliberately deferred: the graph only consumes the metadata fields, so
 * the project can decide which modules truly need new output before paying for
 * the zimmerframe walk + esrap print.
 */
export interface CompileAnalysis {
	/** Filename (used for error messages, source maps, CSS scoping). */
	filename: string;
	/** Original source text. */
	source: string;
	/** Analyzer result: AST, scope tree, binding metadata (codegen input). */
	result: AnalysisResult;
	/** Preprocessor result (component metadata, spans, source map). */
	preprocessed: PreprocessResult;
	/** OXC TS-strip source map — chained into codegen's remap (esrap → strip → preprocess). */
	strippedMap: OxcSourceMap | null;
	/** Reactive exports this module provides to its importers. */
	reactiveExports: string[];
	/**
	 * Cross-file reactive function calls detected at call sites.
	 * Maps import specifier → { exportedName → reactive param indices }.
	 */
	reactiveCalls: Record<string, Record<string, number[]>>;
	/** Import specifiers found in this module. */
	importSpecifiers: string[];
}

/**
 * Phase 1 of the split pipeline: preprocess custom syntax, strip TypeScript,
 * parse, and analyze — producing the metadata the project graph runs on and
 * the analysis the transform walks. No code is generated.
 */
export function analyzeSource(source: string, options: CompileOptions = {}): CompileAnalysis {
	const filename = options.filename || 'input.tsx';

	// Phase 1: Pre-process custom syntax
	const preprocessed = preprocess(source, { filename });

	// Strip TypeScript with oxc-transform — a real transpiler: it emits JS
	// for enums, namespaces, parameter properties, etc. (an in-tree node
	// stripper cannot). JSX is preserved; the $$s/$$d/$$style markers
	// survive as identifiers/elements. Its source map is chained into the
	// output map — [esrap map, strip map, preprocess map] — which lands
	// printed positions on the authored source, at oxc's codegen-level
	// granularity.
	const stripped = oxcTransformSync(filename, preprocessed.code, { sourcemap: true, jsx: 'preserve' });

	// Phase 2: Parse with OXC
	const parseResult = parse(filename, stripped.code, 'jsx');
	if (parseResult.errors.length > 0) {
		const errorMessages = parseResult.errors.map((e) => e.message).join('\n');
		throw new Error(`Parse errors in ${filename}:\n${errorMessages}`);
	}

	// Phase 3: Analyze — walk AST, build scope tree + metadata
	const result = analyzeAst(
		parseResult.program,
		stripped.code,
		preprocessed,
		options.reactiveImports,
		options.reactiveCallImports,
	);

	return {
		filename,
		source,
		result,
		preprocessed,
		strippedMap: stripped.map ?? null,
		reactiveExports: result.reactiveExports,
		reactiveCalls: result.reactiveCalls,
		importSpecifiers: result.importSpecifiers,
	};
}

/**
 * Phase 4 of the split pipeline: walk the analysis with zimmerframe, print with
 * esrap, chain the source maps, and (optionally) collect position artifacts.
 * The analysis is consumed — its AST is rewritten in place.
 */
export function generateOutput(
	analysis: CompileAnalysis,
	css: 'injected' | 'external' = 'injected',
): CompileResult {
	const { filename } = analysis;

	// Phase 4: Transform — walk AST with zimmerframe, print with esrap.
	// The printed map is in stripped coordinates, so the remap chain runs
	// [esrap map, oxc-strip map, preprocess map] to land on the authored
	// source.
	const result = transform(analysis.result, filename, css);

	return {
		js: {
			code: result.code,
			map: remapping([result.map, analysis.strippedMap, analysis.preprocessed.map], () => null),
		},
		css: {
			code: result.css,
			map: null
		},
		metadata: {
			reactiveExports: analysis.reactiveExports,
			reactiveCalls: analysis.reactiveCalls,
			importSpecifiers: analysis.importSpecifiers,
		},
		ast: result.ast,
	};
}

/**
 * Compile a DarTsx source file into JavaScript — the single-pass convenience
 * form of `analyzeSource` + `generateOutput`.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
	return generateOutput(analyzeSource(source, options), options.css ?? 'injected');
}
