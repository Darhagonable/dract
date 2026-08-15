/**
 * ProjectCompiler — incremental, multi-file compilation for DarTsx.
 *
 * The per-file `compile()` cannot see its neighbours: cross-file reactivity
 * (an imported `state` remaining a signal, a callee's reactive parameters)
 * requires the project layer to track, per module, the cross-file graph.
 *
 * This module is the composition root. The graph state lives in `graph.ts`
 * (`ProjectGraph`: records, resolved imports, reverse edges, reactive
 * exports, call contributions), the incremental machinery lives in
 * `builder.ts` (`ProjectBuilder`: worklist, import resolution, the two-phase
 * analyze→generate run), and the metadata → invalidation rules live in
 * `reconcile.ts`. The compiler itself knows none of them — it stays
 * completely filesystem-agnostic: files enter through
 * `addFile`/`updateFile`/`removeFile`, and unknown imports are requested
 * through the injected `loadFile` callback.
 *
 * Incremental semantics:
 *
 *   - `updateFile(id, source)` with an unchanged source is a no-op; no file is
 *     recompiled. Unknown ids are accepted (a fresh file simply joins the
 *     project) — callers never need to ask whether a file exists first.
 *   - Editing a file's BODY recompiles that file alone: reactive exports and
 *     call contributions are source-structure facts, and while they are
 *     unchanged no importer or callee is invalidated.
 *   - A changed reactive export set recompiles every importer (with updated
 *     `reactiveImports`); a changed contribution recompiles the affected
 *     target (with updated `reactiveCallImports`).
 */
import { ProjectBuilder, type ProjectBuilderOptions } from './builder';
import { type ModuleOutput, type ProjectUpdate, ProjectGraph } from './graph';

export type { ModuleOutput, ProjectUpdate };

export interface ProjectCompilerOptions {
	/**
	 * CSS delivery mode, forwarded to every compile.
	 * Default: `'injected'`.
	 */
	css?: 'injected' | 'external';
	/**
	 * Resolve an import specifier to an id outside the project's own file set
	 * (aliases, node_modules, URL imports). Return null to leave it unresolved.
	 * The default resolves nothing outside the project.
	 */
	resolveExternal?: (specifier: string, importerId: string) => string | null;
	/**
	 * Load the source for an id the project does not know yet (an import of a
	 * file that has not been added). Return null to leave it unresolved. The
	 * adapter decides where files come from; the compiler never touches the
	 * filesystem itself.
	 */
	loadFile?: (id: string) => string | null;
}

export class ProjectCompiler {
	private readonly graph = new ProjectGraph();
	private readonly builder: ProjectBuilder;

	constructor(options: ProjectCompilerOptions = {}) {
		const resolved: ProjectBuilderOptions = {
			css: options.css ?? 'injected',
			resolveExternal: options.resolveExternal ?? (() => null),
			loadFile: options.loadFile ?? (() => null),
		};
		this.builder = new ProjectBuilder(this.graph, resolved);
	}

	/** The current output for one id, or null when the project has none. */
	output(id: string): ModuleOutput | null {
		return this.graph.output(id);
	}

	/** Add (or replace) a file's source without compiling. Idempotent. */
	addFile(id: string, source: string): void {
		this.graph.setSource(id, source);
		// A file that could not be resolved before (its target wasn't in the
		// project yet, e.g. it is added AFTER its importer in the same call)
		// gets another chance now that `id` exists.
		this.builder.sweepLateResolutions();
	}

	/** Compile every file that has no output yet (or whose source changed via addFile). */
	compileAll(): Map<string, ModuleOutput> {
		for (const [id, record] of this.graph.files) {
			if (!record.output) this.builder.enqueue(id);
		}
		this.builder.run();
		const result = new Map<string, ModuleOutput>();
		for (const [id, record] of this.graph.files) {
			if (record.output) result.set(id, record.output);
		}
		return result;
	}

	/**
	 * Update one file's source and recompile whatever the change invalidates.
	 * Returns the ids recompiled by this call. Throws the compiler's error when
	 * the file fails to compile — the caller is expected to surface it (and may
	 * re-update the same source later, which re-runs the compile as long as no
	 * output was produced).
	 */
	updateFile(id: string, source: string): ProjectUpdate {
		const changed: string[] = [];
		const record = this.graph.files.get(id);
		if (record && record.source === source && record.output) {
			// Unchanged source with a valid output — nothing this file provides
			// to its neighbours changed, so no file is invalidated. (A file
			// whose INPUTS changed under it is recompiled by the caller's
			// cascade instead.)
			return { changed };
		}
		this.addFile(id, source);
		this.builder.enqueue(id);
		this.builder.run(changed);
		return { changed };
	}

	/**
	 * Remove a file and recompile everyone whose inputs it fed (importers and
	 * contribution targets) — their outputs stop referencing the removed
	 * module's reactivity (imports become plain external references).
	 */
	removeFile(id: string): ProjectUpdate {
		const affected = this.graph.removeFile(id);
		if (affected.size === 0) return { changed: [] };
		const changed: string[] = [];
		// Recompile the affected files against the reduced graph.
		for (const fileId of affected) this.builder.enqueue(fileId);
		this.builder.run(changed);
		return { changed };
	}
}