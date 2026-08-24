// The compiler boundary. The Workspace/UI never talks to oxc or the dartsx
// Project directly — it talks to a Compiler. Today that is ProjectCompiler,
// running WASM in this thread; tomorrow it is WorkerCompilerClient speaking
// postMessage to a worker running the same code. The swap is an
// implementation change, not an architectural one.
//
// Client-only: instantiate lazily (dynamic import of the WASM bindings must
// never run during SSR).
import { Project } from 'dartsx/compiler';
import { isTsconfigFile, type PlaygroundFile } from './types.ts';

/** One compiled artifact as the compiled pane and AST inspector consume it. */
export interface CompiledModule {
	code: string;
	/** The compiled output's AST for the AST pane. */
	ast: unknown;
	/** The compile's source map (output → authored) for code mappings. */
	map: { mappings: string | unknown[][] } | null;
}

export interface Compiler {
	/**
	 * Bring the compiler's incremental state in line with the workspace's
	 * file set and compile everything it invalidates.
	 */
	compile(files: readonly PlaygroundFile[]): Promise<void>;
	/**
	 * The compiled artifact for one file, or null when it has none. Files
	 * whose last compile threw return null too — the pane must show the
	 * error, not stale code.
	 */
	outputFor(name: string): CompiledModule | null;
	/** The last compile error for one file, or null when it compiled. */
	errorFor(name: string): string | null;
}

export class ProjectCompiler implements Compiler {
	/** The workspace file set the project host reads from (synced per compile). */
	private currentFiles = new Map<string, PlaygroundFile>();
	private currentNames = new Set<string>();
	/** File names the project knows about, for remove() diffs. */
	private known = new Set<string>();
	/** Last compile error per file — `update` throws; errors surface per file. */
	private errors = new Map<string, string>();

	private readonly project = new Project({
		css: 'injected',
		entryPoints: [],
		host: {
			resolve: (specifier) => {
				if (!specifier.startsWith('./')) return undefined;
				const base = specifier.slice(2);
				for (const ext of ['', '.tsx', '.ts']) {
					if (this.currentNames.has(base + ext)) return base + ext;
				}
				return undefined;
			},
			readFile: (id) => this.currentFiles.get(id)?.source,
		},
	});

	async compile(files: readonly PlaygroundFile[]): Promise<void> {
		this.currentFiles = new Map(files.map((f) => [f.name, f]));
		this.currentNames = new Set(this.currentFiles.keys());

		for (const name of [...this.known]) {
			if (this.currentFiles.has(name)) continue;
			this.project.remove(name);
			this.known.delete(name);
			this.errors.delete(name);
		}
		for (const file of files) {
			if (isTsconfigFile(file.name)) continue;
			this.known.add(file.name);
		}

		// Compile the workspace, then recompile whatever the project reports as
		// invalidated: a module's inputs (a caller's reactive-call contributions,
		// an importer's reactive exports) can change under it mid-pass, so its
		// first output may be stale. Each pass recompiles only the invalidated
		// files; the graph converges when a pass invalidates nothing.
		let worklist = [...this.known];
		while (worklist.length > 0) {
			const next: string[] = [];
			for (const name of worklist) {
				const file = this.currentFiles.get(name);
				if (!file) continue;
				try {
					const { invalidated } = await this.project.update(name, file.source);
					this.errors.delete(name);
					for (const id of invalidated) {
						if (this.known.has(id) && !next.includes(id)) next.push(id);
					}
				} catch (error) {
					this.errors.set(name, error instanceof Error ? error.message : String(error));
				}
			}
			worklist = next;
		}
	}

	outputFor(name: string): CompiledModule | null {
		if (this.errors.has(name)) return null;
		const output = this.project.output(name);
		return output ? { code: output.js.code, ast: output.ast, map: output.js.map } : null;
	}

	errorFor(name: string): string | null {
		return this.errors.get(name) ?? null;
	}
}
