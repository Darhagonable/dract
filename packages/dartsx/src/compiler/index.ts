/**
 * DarTsx Compiler
 *
 * Pipeline: preprocess → oxc-transform (strip TS) → parse (OXC) → analyze → transform
 */
import { preprocess, parse } from './phases/1-parse';
import { analyze } from './phases/2-analyze';
import { transform } from './phases/3-transform';
import { transformSync as oxcTransformSync } from 'oxc-transform';

export interface CompileResult {
	/** The generated JavaScript code */
	code: string;
	/** Extracted CSS from scoped style blocks (for external CSS mode) */
	css: string;
	/** Names of exported state/derived variables (for cross-file reactivity) */
	reactiveExports: string[];
	/**
	 * Cross-file reactive function calls detected at call sites.
	 * Maps import specifier → { exportedName → reactive param indices }.
	 */
	reactiveCalls: Record<string, Record<string, number[]>>;
	/** Import specifiers found in this module (for Vite plugin resolution, avoids regex) */
	importSpecifiers: string[];
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
 * Compile a DarTsx source file into JavaScript.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
	const filename = options.filename || 'input.tsx';

	// Phase 1: Pre-process custom syntax + parse with OXC
	const preprocessed = preprocess(source);

	// Strip TypeScript types early using oxc-transform.
	// This removes interfaces, type aliases, type annotations, etc. from the source
	// so the analyzer and transform don't need to handle TS-specific AST nodes.
	// JSX is preserved; the $$s/$$d/$$style markers survive as identifiers/elements.
	const stripped = oxcTransformSync(filename, preprocessed.code, { sourcemap: false, jsx: 'preserve' });

	// Parse as JSX (TS types already stripped by oxcTransformSync above)
	const parseResult = parse(filename, stripped.code, 'jsx');
	if (parseResult.errors.length > 0) {
		const errorMessages = parseResult.errors.map((e) => e.message).join('\n');
		throw new Error(`Parse errors in ${filename}:\n${errorMessages}`);
	}

	// Phase 2: Analyze — walk AST, build scope tree + metadata
	const analysis = analyze(
		parseResult.program,
		stripped.code,
		preprocessed,
		options.reactiveImports,
		options.reactiveCallImports,
	);

	// Phase 3: Transform — walk AST with zimmerframe, print with esrap
	const result = transform(analysis, filename, options.css);

	return {
		code: result.code,
		css: result.css,
		reactiveExports: analysis.reactiveExports,
		reactiveCalls: analysis.reactiveCalls,
		importSpecifiers: analysis.importSpecifiers,
	};
}
