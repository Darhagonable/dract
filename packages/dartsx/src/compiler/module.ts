/**
 * DarTsx Compiler — single-file module compilation.
 *
 * Pipeline: preprocess → oxc-transform (strip TS) → parse (OXC) → analyze → transform
 */
import { preprocess } from './phases/1-preprocess';
import { parse } from './phases/2-parse';
import { analyze } from './phases/3-analyze';
import { transform } from './phases/4-transform';
import { transformSync as oxcTransformSync } from 'oxc-transform';
import remapping, { type SourceMap } from '@jridgewell/remapping';

export interface ModuleOutput {
	/** The compiled JavaScript and its source map. */
	js: {
		/** The generated JavaScript code */
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

export interface CompileModuleOptions {
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
 * Compile a single DarTsx source file into JavaScript.
 *
 * Stateless: no cross-module tracking. For tools that manage multiple
 * modules, use the `Project` entry point, which drives this function
 * under the hood with cross-module reactivity state.
 */
export function compileModule(source: string, options: CompileModuleOptions = {}): ModuleOutput {
	const filename = options.filename || 'input.tsx';

	// Phase 1: Pre-process custom syntax
	const preprocessed = preprocess(source);

	// Strip TypeScript types early using oxc-transform.
	// This removes interfaces, type aliases, type annotations, etc. from the source
	// so the analyzer and transform don't need to handle TS-specific AST nodes.
	// JSX is preserved; the $$s/$$d/$$style markers survive as identifiers/elements.
	const stripped = oxcTransformSync(filename, preprocessed.code, { sourcemap: true, jsx: 'preserve' });

	// Phase 2: Parse with OXC
	const parseResult = parse(filename, stripped.code, 'jsx');
	if (parseResult.errors.length > 0) {
		const errorMessages = parseResult.errors.map((e) => e.message).join('\n');
		throw new Error(`Parse errors in ${filename}:\n${errorMessages}`);
	}

	// Phase 3: Analyze — walk AST, build scope tree + metadata
	const analysis = analyze(
		parseResult.program,
		stripped.code,
		preprocessed,
		options.reactiveImports,
		options.reactiveCallImports,
	);

	// Phase 4: Transform — walk AST with zimmerframe, print with esrap
	const result = transform(analysis, filename, options.css);

	return {
		js: {
			code: result.code,
			map: remapping([result.map, stripped.map, preprocessed.map], () => null),
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