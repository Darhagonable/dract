/**
 * DarTsx Compiler
 *
 * Pipeline: preprocess → parse (OXC) → analyze → transform → output JS
 */
import { preprocess, parse } from './phases/1-parse';
import { analyze } from './phases/2-analyze';
import { transform } from './phases/3-transform';

export interface CompileResult {
    /** The generated JavaScript code */
    code: string;
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
    const parseResult = parse(filename, preprocessed.code);

    if (parseResult.errors.length > 0) {
        const errorMessages = parseResult.errors.map((e: any) => e.message).join('\n');
        throw new Error(`Parse errors in ${filename}:\n${errorMessages}`);
    }

    // Phase 2: Analyze — walk AST, build module-level + component IRs
    const analysis = analyze(
        parseResult.program,
        preprocessed.code,
        preprocessed,
        options.reactiveImports,
        options.reactiveCallImports,
    );

    // Phase 3: Transform — generate output JavaScript
    const code = transform(analysis);

    return {
        code,
        reactiveExports: analysis.reactiveExports,
        reactiveCalls: analysis.reactiveCalls,
        importSpecifiers: analysis.importSpecifiers,
    };
}
