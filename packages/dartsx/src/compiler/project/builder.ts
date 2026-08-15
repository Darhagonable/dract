/**
 * Project builder — the incremental machinery of the project layer.
 *
 * Owns the worklist and the two-phase update. It is completely
 * filesystem-agnostic: sources enter through the injected `loadFile` adapter
 * (the adapter decides where files come from — disk for Vite, an in-memory
 * map for the browser REPL, fixtures for tests), and nothing here touches the
 * filesystem itself.
 *
 * Each update runs in two phases:
 *
 *   Phase A — runAnalysis(): stabilize the graph. The worklist resolves
 *     imports and re-analyzes queued files against the CURRENT graph state,
 *     reconciling metadata as it goes (reactive exports, contributions,
 *     reverse edges) until the graph converges. No code is generated.
 *   Phase B — generateOutputs(): with the queue drained, every analysis is
 *     final (its inputs can no longer change). Each file whose output is
 *     missing or was produced under different inputs is transformed exactly
 *     once, with the exact inputs its output should be generated under.
 *
 * Separating the phases keeps the graph's decisions on cheap analysis
 * metadata: a file whose inputs change twice inside one call is analyzed
 * twice but generated once, and a file whose inputs round-trip back to a
 * state it already generated output for is not regenerated at all.
 *
 * A single update recompiles each (file, input-state) pair at most once; the
 * worklist re-queues a file when its inputs changed under it, which is how
 * loadFile-discovered files and cascades converge in one call.
 *
 * The graph state lives in `graph.ts`; the metadata → invalidation rules live
 * in `reconcile.ts`. The builder owns neither the language semantics nor the
 * file sources — it owns the queue.
 */
import { analyzeSource, generateOutput, type CompileAnalysis } from '../index';
import { extractImportSpecifiers, type ModuleOutput, type ProjectGraph } from './graph';
import { reconcile } from './reconcile';

export interface ProjectBuilderOptions {
	css: 'injected' | 'external';
	resolveExternal: (specifier: string, importerId: string) => string | null;
	loadFile: (id: string) => string | null;
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

export class ProjectBuilder {
	private readonly graph: ProjectGraph;
	private readonly css: 'injected' | 'external';
	private readonly resolveExternal: (specifier: string, importerId: string) => string | null;
	private readonly loadFile: (id: string) => string | null;

	constructor(graph: ProjectGraph, options: ProjectBuilderOptions) {
		this.graph = graph;
		this.css = options.css;
		this.resolveExternal = options.resolveExternal;
		this.loadFile = options.loadFile;
	}

	private queue: string[] = [];
	/** (id, input-state) pairs already analyzed this call — the convergence guard. */
	private analyzedPairs = new Set<string>();
	private queuedIds = new Set<string>();

	enqueue(id: string): void {
		if (this.queuedIds.has(id)) return;
		this.queuedIds.add(id);
		this.queue.push(id);
	}

	private inputsKey(
		reactiveImports: Record<string, string[]> | null,
		reactiveCallImports: Record<string, number[]> | null,
	): string {
		return JSON.stringify([reactiveImports ?? null, reactiveCallImports ?? null]);
	}

	/** Resolve one specifier against the project (siblings, then the adapter). */
	private resolveImport(specifier: string, importerId: string): string | null {
		if (specifier.startsWith('./') || specifier.startsWith('../')) {
			const importerDir = importerId.slice(0, importerId.lastIndexOf('/') + 1);
			const joined = normalizeSlashes(importerDir + specifier);
			for (const extension of SIBLING_EXTENSIONS) {
				const candidate = joined + extension;
				if (this.graph.files.has(candidate)) return candidate;
				// The adapter may know this file (disk for Vite, memory for the
				// browser REPL) — request its source so it joins the project.
				if (this.loadFile) {
					const source = this.loadFile(candidate);
					if (source !== null) {
						this.graph.setSource(candidate, source);
						this.sweepLateResolutions();
						this.enqueue(candidate);
						return candidate;
					}
				}
			}
		}
		return this.resolveExternal(specifier, importerId);
	}

	/**
	 * Re-resolve every unresolved relative import against the current project.
	 * Files are added one at a time; an importer compiled before its target
	 * existed registered no edge, so the target's export publish could never
	 * reach it. Sweeping after each new source converges the graph in one call.
	 */
	sweepLateResolutions(): void {
		for (const [fileId, record] of this.graph.files) {
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
	 * The two phases of an update: stabilize the graph on analysis metadata,
	 * then generate code for exactly the files whose output is due.
	 */
	run(changed: string[] = []): void {
		this.runAnalysis();
		this.generateOutputs(changed);
	}

	/**
	 * Phase A — analyze. Drains the worklist: resolve imports, derive each
	 * file's inputs from the CURRENT graph state, and analyze it (parse +
	 * metadata). The result reconciles into the graph, which may enqueue
	 * further files (importers of changed exports, targets of changed
	 * contributions) until the graph converges. No code is generated here.
	 */
	private runAnalysis(): void {
		this.analyzedPairs = new Set();
		this.queuedIds = new Set();
		while (this.queue.length > 0) {
			const id = this.queue.shift()!;
			this.queuedIds.delete(id);
			const record = this.graph.files.get(id);
			if (!record) continue;

			// 1. Resolve imports (loadFile may add new files, which join the queue).
			const specifiers = record.importSpecifiers.length > 0
				? record.importSpecifiers
				: extractImportSpecifiers(record.source);
			for (const specifier of specifiers) {
				if (record.resolvedTargets.has(specifier)) continue;
				let target = this.resolveImport(specifier, id);
				if (target !== null && !this.graph.files.has(target)) {
					// The adapter may know this file — request its source.
					const source = this.loadFile(target);
					if (source !== null) {
						this.graph.setSource(target, source);
						this.sweepLateResolutions();
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
				const exports = this.graph.reactiveExports.get(target);
				if (exports && exports.length > 0) reactiveImports[specifier] = exports;
			}
			const reactiveCallImports = this.graph.mergedReactiveCalls.get(id) ?? null;
			const key = this.inputsKey(
				Object.keys(reactiveImports).length > 0 ? reactiveImports : null,
				reactiveCallImports,
			);
			// Already analyzed with exactly these inputs in this call — nothing
			// new can come out of it.
			if (this.analyzedPairs.has(id + '\u0000' + key)) continue;
			this.analyzedPairs.add(id + '\u0000' + key);

			// 3. Analyze — parse + metadata only; codegen is deferred so the
			// graph can converge before any output is produced.
			const analysis = analyzeSource(record.source, {
				filename: id,
				reactiveImports: Object.keys(reactiveImports).length > 0 ? reactiveImports : undefined,
				reactiveCallImports: reactiveCallImports ?? undefined,
			});
			record.analysis = analysis;
			record.analysisKey = key;

			// 4. Reconcile the graph and propagate invalidation.
			reconcile(this.graph, record, analysis, (fileId) => this.enqueue(fileId));
		}
	}

	/**
	 * Phase B — generate. With the queue drained, every analysis is final (its
	 * inputs can no longer change), so each file is transformed at most once
	 * per call, under the exact inputs its output should be generated with. A
	 * file whose inputs round-tripped to a state it already generated output
	 * for is skipped entirely. Analyses are transient — they are dropped once
	 * codegen is done.
	 */
	private generateOutputs(changed: string[]): void {
		for (const [id, record] of this.graph.files) {
			const analysis = record.analysis;
			if (!analysis) continue;
			// The current output is still valid when it was produced under the
			// same inputs the final analysis was — generation is a pure
			// function of (source, inputs), and a changed source always
			// nulls the output via the graph.
			if (record.output && record.outputKey === record.analysisKey) continue;

			const result = generateOutput(analysis, this.css);
			const output: ModuleOutput = {
				id,
				js: {
					code: result.js.code,
					map: result.js.map,
				},
				css: result.css,
				metadata: {
					reactiveExports: analysis.reactiveExports,
					reactiveCalls: analysis.reactiveCalls,
					importSpecifiers: analysis.importSpecifiers,
				},
				imports: [...record.resolvedTargets.values()].filter((t): t is string => t !== null),
				ast: result.ast,
			};
			record.output = output;
			record.outputKey = record.analysisKey;
			changed.push(id);
		}
		// Analyses are only needed until codegen — drop them all.
		for (const [, record] of this.graph.files) {
			record.analysis = null;
			record.analysisKey = null;
		}
	}
}