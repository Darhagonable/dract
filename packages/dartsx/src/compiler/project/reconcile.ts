/**
 * Reconcile — the rules that turn one file's analysis into graph mutations
 * and invalidation, run by the builder after every `analyzeSource`.
 *
 * The graph's incremental contract lives here. A file's analysis carries
 * metadata facts (`reactiveExports`, `reactiveCalls`, `importSpecifiers`);
 * reconcile publishes the facts into the graph and re-queues exactly the
 * files whose *inputs* the facts changed:
 *
 *   - changed reactive exports → every importer (new `reactiveImports`)
 *   - changed contributions → the affected targets (new `reactiveCallImports`)
 *   - dropped imports → diffed reverse edges stop feeding the old target
 *
 * Nothing here decides when to compile — `enqueue` is injected by the
 * builder, which owns the worklist.
 */
import type { CompileAnalysis } from '../index';
import type { FileRecord, ProjectGraph } from './graph';

export function reconcile(
	graph: ProjectGraph,
	record: FileRecord,
	analysis: CompileAnalysis,
	enqueue: (id: string) => void,
): void {
	const id = record.id;

	// Cached import specifiers (re-lexing avoided on resolution).
	record.importSpecifiers = analysis.importSpecifiers;

	// Reactive exports: publish, and recompile importers on change.
	const exportsChanged =
		JSON.stringify(graph.reactiveExports.get(id) ?? []) !== JSON.stringify(analysis.reactiveExports);
	graph.reactiveExports.set(id, analysis.reactiveExports);
	if (exportsChanged) {
		for (const caller of graph.reverseImports.get(id) ?? []) enqueue(caller);
	}

	// Reverse edges from this file's resolution — diff against the previous
	// targets so a dropped import stops receiving invalidation.
	const targets = new Set(record.resolvedTargets.values());
	for (const target of record.lastTargets) {
		if (target === null || targets.has(target)) continue;
		const callers = graph.reverseImports.get(target);
		if (callers) {
			callers.delete(id);
			if (callers.size === 0) graph.reverseImports.delete(target);
		}
	}
	record.lastTargets = [...targets].filter((t): t is string => t !== null);
	for (const target of record.lastTargets) {
		const callers = graph.reverseImports.get(target);
		if (callers) callers.add(id);
		else graph.reverseImports.set(target, new Set([id]));
	}

	// Contributions: caller `id` → resolved targets of its reactive calls.
	const previous = graph.contributions.get(id);
	const affectedTargets = new Set<string>();
	if (previous) for (const target of previous.keys()) affectedTargets.add(target);
	const newContribs = new Map<string, Record<string, number[]>>();
	for (const [specifier, fns] of Object.entries(analysis.reactiveCalls)) {
		const target = record.resolvedTargets.get(specifier) ?? null;
		if (target === null) continue;
		newContribs.set(target, fns);
		affectedTargets.add(target);
	}
	if (newContribs.size > 0) graph.contributions.set(id, newContribs);
	else graph.contributions.delete(id);

	// Rebuild the merged target registries and recompile changed targets.
	for (const target of affectedTargets) {
		const merged: Record<string, Set<number>> = {};
		for (const [, callerTargets] of graph.contributions) {
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
		const prevKey = JSON.stringify(graph.mergedReactiveCalls.get(target) ?? {});
		if (nextKey === prevKey) continue;
		if (Object.keys(resultMap).length > 0) graph.mergedReactiveCalls.set(target, resultMap);
		else graph.mergedReactiveCalls.delete(target);
		// If the target is known and its inputs changed, recompile it.
		if (graph.files.has(target)) enqueue(target);
	}
}