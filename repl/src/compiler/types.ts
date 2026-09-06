/** A virtual file pushed to the compiler worker. */
export interface CompilerFile {
	name: string;
	source: string;
}

/** One file's compilation result: output on success, error on failure. */
export interface FileOutput {
	code: string | null;
	map: unknown | null;
	error: string | null;
}

/** All results of one compile run, keyed by file name. */
export type CompileOutputs = Record<string, FileOutput>;
