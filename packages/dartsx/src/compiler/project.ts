/**
 * Project Compiler — incremental, multi-file compilation for DarTsx.
 *
 * The per-file `compile()` cannot see its neighbours: cross-file reactivity
 * (an imported `state` remaining a signal, a callee's reactive parameters)
 * requires the project layer to track, per module:
 *
 *   - the source and its last compiled output
 *   - resolved imports (specifier → target id) and reverse edges
 *   - reactive exports per target (what an importer gets as `reactiveImports`)
 *   - per-caller reactive-call contributions, merged per target (what a target
 *     gets as `reactiveCallImports`)
 *
 * This module OWNS that graph. It is completely filesystem-agnostic: files
 * enter through `addFile`/`updateFile`/`removeFile`, and a file whose imports
 * point at an id the project does not know is requested through the injected
 * `loadFile` callback (the adapter decides where sources come from — disk for
 * Vite, an in-memory map for the browser REPL, fixtures for tests) or left
 * unresolved (no cross-file metadata, like any bare external import).
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
 *
 * A single update recompiles each (file, input-state) pair at most once; the
 * worklist re-queues a file when its inputs changed under it, which is how the
 * loadFile-discovered and recompiled files converge to a consistent graph in
 * one call.
 */
import { compile, type CompileResult } from './index';
import type { SourceMap } from '@jridgewell/remapping';

export interface ModuleOutput {
	/** The resolved module id. */
	id: string;
	/** The compiled JavaScript and its source map. */
	js: {
		/** The generated code. */
		code: string;
		/** Source map from output positions to original source positions. */
		map: SourceMap;
	};
	/** The compiled CSS, from the source style blocks. */
	css: {
		/** The generated code. */
		code: string;
		/** Source map from CSS output positions to source positions (not built yet). */
		map: SourceMap | null;
	};
	/** Metadata about the compiled module. */
	metadata: {
		/** Reactive exports this module provides to its importers. */
		reactiveExports: string[];
		/**
		 * Cross-file reactive function calls detected at call sites.
		 * Maps import specifier → { exportedName → reactive param indices }.
		 */
		reactiveCalls: Record<string, Record<string, number[]>>;
		/** Import specifiers found in this module. */
		importSpecifiers: string[];
	};
	/** The exact program that was printed as the emitted module. */
	ast: unknown;
	/** Resolved ids of this module's imports (external/unresolved omitted). */
	imports: string[];
}

export interface ProjectUpdate {
	/** Ids whose output was (re)compiled by this call. */
	changed: string[];
}
// Outputs are read back per id through `output(id)` — callers keep their own
// map of what they serve, so an update never copies the whole output set.

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

const SIBLING_EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js'];

/** Resolve './a/../b' style relative ids into normalized slashed ids. */
function normalizeSlashes(id: string): string {
	const absolute = id.startsWith('/');
	const parts: string[] = [];
	for (const part of id.split('/')) {
		if (part === '.' || part === '') continue;
		if (part === '..') {
			if (parts.length > 0) parts.pop();
			continue;
		}
		parts.push(part);
	}
	return (absolute ? '/' : '') + parts.join('/');
}

const IMPORT_RE = /import\s+(?:[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;

function extractImportSpecifiers(code: string): string[] {
	const specifiers = new Set<string>();
	let match: RegExpExecArray | null;
	while ((match = IMPORT_RE.exec(code)) !== null) {
		specifiers.add(match[1]);
	}
	return [...specifiers];
}

interface FileRecord {
	id: string;
	source: string;
	output: ModuleOutput | null;
	/** Specifiers of the last analysis (cached — avoids re-lexing on resolution). */
	importSpecifiers: string[];
	/** Specifier → resolved target id (null = unresolved/external). */
	resolvedTargets: Map<string, string | null>;
	/** The resolved targets of the last compile (for reverse-edge diffs). */
	lastTargets: string[];
}

export class ProjectCompiler {
	private files = new Map<string, FileRecord>();
	/** target id → caller ids (for reactive-export propagation). */
	private reverseImports = new Map<string, Set<string>>();
	/** target id → reactive export names (the importer-side input). */
	private reactiveExports = new Map<string, string[]>();
	/** caller id → target id → { fn → reactive param indices }. */
	private contributions = new Map<string, Map<string, Record<string, number[]>>>();
	/** target id → merged reactive call params (the target-side input). */
	private mergedReactiveCalls = new Map<string, Record<string, number[]>>();

	private readonly css: 'injected' | 'external';
	private readonly resolveExternal: (specifier: string, importerId: string) => string | null;
	private readonly loadFile: (id: string) => string | null;

	constructor(options: ProjectCompilerOptions = {}) {
		this.css = options.css ?? 'injected';
		this.resolveExternal = options.resolveExternal ?? (() => null);
		this.loadFile = options.loadFile ?? (() => null);
	}

	/** The current output for one id, or null when the project has none. */
	output(id: string): ModuleOutput | null {
		return this.files.get(id)?.output ?? null;
	}

	/** Add (or replace) a file's source without compiling. Idempotent. */
	addFile(id: string, source: string): void {
		const existing = this.files.get(id);
		if (existing) {
			existing.source = source;
			// Source changed — the compiled output and cached metadata are stale.
			existing.output = null;
			existing.importSpecifiers = extractImportSpecifiers(source);
			existing.resolvedTargets = new Map();
			existing.lastTargets = [];
		} else {
			this.files.set(id, {
				id,
				source,
				output: null,
				importSpecifiers: extractImportSpecifiers(source),
				resolvedTargets: new Map(),
				lastTargets: [],
			});
		}
		// A file that could not be resolved before (its target wasn't in the
		// project yet, e.g. it is added AFTER its importer in the same call)
		// gets another chance now that `id` exists.
		this.sweepLateResolutions();
	}

	/**
	 * Re-resolve every unresolved relative import against the current project.
	 * Files are added one at a time; an importer compiled before its target
	 * existed registered no edge, so the target's export publish could never
	 * reach it. Sweeping after each addFile converges the graph in one call.
	 */
	private sweepLateResolutions(): void {
		for (const [fileId, record] of this.files) {
			for (const [specifier, target] of record.resolvedTargets) {
				if (target !== null) continue;
				if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
				const resolved = this.resolveImport(specifier, fileId);
				if (resolved !== null) {
					record.resolvedTargets.set(specifier, resolved);
					this.enqueue(fileId);
				}
			}
		}
	}

	/**
	 * Compile every file that has no output yet (or whose source changed via
	 * addFile) and return the project's full output map — the bulk-operation
	 * counterpart to `updateFile`/`output`, for callers that compile a whole
	 * project at once (tests, build steps).
	 */
	compileAll(): Map<string, ModuleOutput> {
		const changed: string[] = [];
		for (const [id, record] of this.files) {
			if (!record.output) this.enqueue(id);
		}
		this.runQueue(changed);
		const result = new Map<string, ModuleOutput>();
		for (const [id, record] of this.files) {
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
		const record = this.files.get(id);
		if (record && record.source === source && record.output) {
			// Unchanged source with a valid output — nothing this file provides
			// to its neighbours changed, so no file is invalidated. (A file
			// whose INPUTS changed under it is recompiled by the caller's
			// cascade instead.)
			return { changed };
		}
		this.addFile(id, source);
		this.enqueue(id);
		this.runQueue(changed);
		return { changed };
	}

	/**
	 * Remove a file and recompile everyone whose inputs it fed (importers and
	 * contribution targets) — their outputs stop referencing the removed
	 * module's reactivity (imports become plain external references).
	 */
	removeFile(id: string): ProjectUpdate {
		const record = this.files.get(id);
		if (!record) return { changed: [] };
		this.files.delete(id);
		const affected = new Set<string>();
		// Importers lose their reactive exports source.
		for (const caller of this.reverseImports.get(id) ?? []) {
			affected.add(caller);
			// Their contributions toward `id` are now unresolvable — drop them.
			const callerContribs = this.contributions.get(caller);
			if (callerContribs) {
				callerContribs.delete(id);
				if (callerContribs.size === 0) this.contributions.delete(caller);
			}
		}
		this.reverseImports.delete(id);
		this.reactiveExports.delete(id);
		const targetContribs = this.contributions.get(id);
		if (targetContribs) {
			for (const target of targetContribs.keys()) affected.add(target);
		}
		this.contributions.delete(id);
		this.mergedReactiveCalls.delete(id);
		// Any file whose imports resolved to `id` must re-resolve (unresolved now).
		for (const [, candidate] of this.files) {
			for (const [specifier, target] of candidate.resolvedTargets) {
				if (target === id) {
					candidate.resolvedTargets.set(specifier, null);
					affected.add(candidate.id);
				}
			}
		}
		// Recompile the affected files against the reduced graph.
		const changed: string[] = [];
		for (const fileId of affected) this.enqueue(fileId);
		this.runQueue(changed);
		return { changed };
	}

	// ── Internal machinery ──────────────────────────────────────────────────

	private queue: string[] = [];
	/** (id, input-state) pairs already compiled this call — the convergence guard. */
	private compiledPairs = new Set<string>();
	private queuedIds = new Set<string>();

	private inputsKey(
		reactiveImports: Record<string, string[]> | null,
		reactiveCallImports: Record<string, number[]> | null,
	): string {
		return JSON.stringify([reactiveImports ?? null, reactiveCallImports ?? null]);
	}

	private enqueue(id: string): void {
		if (this.queuedIds.has(id)) return;
		this.queuedIds.add(id);
		this.queue.push(id);
	}

	/** Resolve one specifier against the project (siblings, then the adapter). */
	private resolveImport(specifier: string, importerId: string): string | null {
		if (specifier.startsWith('./') || specifier.startsWith('../')) {
			const importerDir = importerId.slice(0, importerId.lastIndexOf('/') + 1);
			const joined = normalizeSlashes(importerDir + specifier);
			for (const extension of SIBLING_EXTENSIONS) {
				const candidate = joined + extension;
				if (this.files.has(candidate)) return candidate;
				// The adapter may know this file (disk for Vite, memory for the
				// browser REPL) — request its source so it joins the project.
				if (this.loadFile) {
					const source = this.loadFile(candidate);
					if (source !== null) {
						this.addFile(candidate, source);
						this.enqueue(candidate);
						return candidate;
					}
				}
			}
		}
		return this.resolveExternal(specifier, importerId);
	}

	private runQueue(changed: string[]): void {
		this.compiledPairs = new Set();
		this.queuedIds = new Set();
		while (this.queue.length > 0) {
			const id = this.queue.shift()!;
			this.queuedIds.delete(id);
			const record = this.files.get(id);
			if (!record) continue;

			// 1. Resolve imports (loadFile may add new files, which join the queue).
			const specifiers = record.importSpecifiers.length > 0
				? record.importSpecifiers
				: extractImportSpecifiers(record.source);
			for (const specifier of specifiers) {
				if (record.resolvedTargets.has(specifier)) continue;
				let target = this.resolveImport(specifier, id);
				if (target !== null && !this.files.has(target)) {
					// The adapter may know this file — request its source.
					const source = this.loadFile(target);
					if (source !== null) {
						this.addFile(target, source);
						this.enqueue(target);
					} else {
						target = null;
					}
				}
				record.resolvedTargets.set(specifier, target);
			}

			// 2. Derive this file's inputs from the CURRENT graph state.
			const reactiveImports: Record<string, string[]> = {};
			for (const [specifier, target] of record.resolvedTargets) {
				if (target === null) continue;
				const exports = this.reactiveExports.get(target);
				if (exports && exports.length > 0) reactiveImports[specifier] = exports;
			}
			const reactiveCallImports = this.mergedReactiveCalls.get(id) ?? null;
			const key = this.inputsKey(
				Object.keys(reactiveImports).length > 0 ? reactiveImports : null,
				reactiveCallImports,
			);
			// Already compiled with exactly these inputs in this call — nothing
			// new can come out of it.
			if (this.compiledPairs.has(id + '\u0000' + key)) continue;
			this.compiledPairs.add(id + '\u0000' + key);

			// 3. Compile.
			const result = compile(record.source, {
				filename: id,
				css: this.css,
				reactiveImports: Object.keys(reactiveImports).length > 0 ? reactiveImports : undefined,
				reactiveCallImports: reactiveCallImports ?? undefined,
			});

			// 4. Reconcile the graph and propagate invalidation.
			this.reconcile(record, result, changed);
		}
	}

	private reconcile(record: FileRecord, result: CompileResult, changed: string[]): void {
		const id = record.id;

		// Output + cached metadata.
		const output: ModuleOutput = {
			id,
			js: {
				code: result.js.code,
				map: result.js.map,
			},
			css: {
				code: result.css.code,
				map: result.css.map,
			},
			metadata: {
				reactiveExports: result.metadata.reactiveExports,
				reactiveCalls: result.metadata.reactiveCalls,
				importSpecifiers: result.metadata.importSpecifiers,
			},
			ast: result.ast,
			imports: [...record.resolvedTargets.values()].filter((t): t is string => t !== null),
		};
		record.output = output;
		record.importSpecifiers = result.metadata.importSpecifiers;
		changed.push(id);

		// Reactive exports: publish, and recompile importers on change.
		const exportsChanged =
			JSON.stringify(this.reactiveExports.get(id) ?? []) !== JSON.stringify(result.metadata.reactiveExports);
		this.reactiveExports.set(id, result.metadata.reactiveExports);
		if (exportsChanged) {
			for (const caller of this.reverseImports.get(id) ?? []) this.enqueue(caller);
		}

		// Reverse edges from this file's resolution — diff against the previous
		// targets so a dropped import stops receiving invalidation.
		const targets = new Set(record.resolvedTargets.values());
		for (const target of record.lastTargets) {
			if (target === null || targets.has(target)) continue;
			const callers = this.reverseImports.get(target);
			if (callers) {
				callers.delete(id);
				if (callers.size === 0) this.reverseImports.delete(target);
			}
		}
		record.lastTargets = [...targets].filter((t): t is string => t !== null);
		for (const target of record.lastTargets) {
			const callers = this.reverseImports.get(target);
			if (callers) callers.add(id);
			else this.reverseImports.set(target, new Set([id]));
		}

		// Contributions: caller `id` → resolved targets of its reactive calls.
		const previous = this.contributions.get(id);
		const affectedTargets = new Set<string>();
		if (previous) for (const target of previous.keys()) affectedTargets.add(target);
		const newContribs = new Map<string, Record<string, number[]>>();
		for (const [specifier, fns] of Object.entries(result.metadata.reactiveCalls)) {
			const target = record.resolvedTargets.get(specifier) ?? null;
			if (target === null) continue;
			newContribs.set(target, fns);
			affectedTargets.add(target);
		}
		if (newContribs.size > 0) this.contributions.set(id, newContribs);
		else this.contributions.delete(id);

		// Rebuild the merged target registries and recompile changed targets.
		for (const target of affectedTargets) {
			const merged: Record<string, Set<number>> = {};
			for (const [, callerTargets] of this.contributions) {
				const contribution = callerTargets.get(target);
				if (!contribution) continue;
				for (const [fnName, indices] of Object.entries(contribution)) {
					if (!merged[fnName]) merged[fnName] = new Set();
					for (const index of indices) merged[fnName].add(index);
				}
			}
			const resultMap: Record<string, number[]> = {};
			for (const [fnName, indices] of Object.entries(merged)) {
				resultMap[fnName] = [...indices].sort((a, b) => a - b);
			}
			const nextKey = JSON.stringify(resultMap);
			const prevKey = JSON.stringify(this.mergedReactiveCalls.get(target) ?? {});
			if (nextKey === prevKey) continue;
			if (Object.keys(resultMap).length > 0) this.mergedReactiveCalls.set(target, resultMap);
			else this.mergedReactiveCalls.delete(target);
			// If the target is known and its inputs changed, recompile it.
			if (this.files.has(target)) this.enqueue(target);
		}
	}
}
