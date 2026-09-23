/** A virtual file pushed to the compiler worker. */
export interface CompilerFile {
	name: string;
	source: string;
}

/** One file's compilation result: output on success, error on failure. */
export interface FileOutput {
	code: string | null;
	error: string | null;
}

/** All results of one compile run, keyed by file name. */
export type CompileOutputs = Record<string, FileOutput>;

/** A module with its relative imports rewritten to module tokens. */
export interface PreviewModule {
	name: string;
	code: string;
}

/** The runnable module set for the preview sandbox. */
export interface PreviewGraph {
	entry: string;
	modules: PreviewModule[];
}

/** One compile response: per-file outputs, plus the graph when the run is clean. */
export interface CompileResult {
	outputs: CompileOutputs;
	/** Present when every file compiled; null when any file errored. */
	graph: PreviewGraph | null;
	/** Present when compilation was clean but the graph could not be built. */
	graphError: string | null;
}

// Preview module tokens: the graph builder rewrites relative imports to
// these, and the sandbox bootstrap resolves them to blob URLs. The format
// lives here, once — the sandbox interpolates these constants into its
// bootstrap source string.
export const MODULE_TOKEN_PREFIX = '__pg_module:';
export const MODULE_TOKEN_SUFFIX = '__';
export const MODULE_TOKEN_PATTERN_SOURCE = `${MODULE_TOKEN_PREFIX}([\\w.-]+?)${MODULE_TOKEN_SUFFIX}`;

export function moduleToken(name: string): string {
	return MODULE_TOKEN_PREFIX + name + MODULE_TOKEN_SUFFIX;
}
