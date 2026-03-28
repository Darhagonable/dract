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
}

export interface CompileOptions {
    /** Filename (used for error messages and source maps) */
    filename?: string;
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

    // Phase 2: Analyze — walk AST, build component IRs
    const components = analyze(parseResult.program, preprocessed.code, preprocessed);

    // Phase 3: Transform — generate output JavaScript
    const code = transform(components);

    return { code };
}
