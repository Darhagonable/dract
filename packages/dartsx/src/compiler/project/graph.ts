/**
 * Project graph — the cross-file state the project layer runs on.
 *
 * Owns, per module:
 *
 *   - the source and its last compiled output
 *   - resolved imports (specifier → target id) and reverse edges
 *   - reactive exports per target (what an importer gets as `reactiveImports`)
 *   - per-caller reactive-call contributions, merged per target (what a target
 *     gets as `reactiveCallImports`)
 *
 * Every edge is directed the way the semantics flow: `reverseImports` maps
 * target → callers (for reactive-export propagation), `contributions` maps
 * caller → target → { fn → reactive param indices }, and `mergedReactiveCalls`
 * holds the union of contributions any target is currently fed by.
 *
 * This module is pure data — no queues, no resolution, no compilation. The
 * worklist and the two-phase run live in `builder.ts`; the rules that turn
 * analysis metadata into graph mutations live in `reconcile.ts`.
 */
import type { CompileAnalysis } from '../index';
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
	/** Resolved ids of this module's imports (external/unresolved omitted). */
	imports: string[];
	/** The exact program that was printed as the emitted module. */
	ast: unknown;
}

export interface ProjectUpdate {
	/** Ids whose output was (re)compiled by this call. */
	changed: string[];
}
// Outputs are read back per id through `output(id)` — callers keep their own
// map of what they serve, so an update never copies the whole output set.

export interface FileRecord {
	id: string;
	source: string;
	output: ModuleOutput | null;
	/** Specifiers of the last analysis (cached — avoids re-lexing on resolution). */
	importSpecifiers: string[];
	/** Specifier → resolved target id (null = unresolved/external). */
	resolvedTargets: Map<string, string | null>;
	/** The resolved targets of the last compile (for reverse-edge diffs). */
	lastTargets: string[];
	/** The analysis awaiting codegen — live only between the two phases. */
	analysis: CompileAnalysis | null;
	/** The inputs state under which `analysis` was produced. */
	analysisKey: string | null;
	/** The inputs state under which `output` was produced. */
	outputKey: string | null;
}

const IMPORT_RE = /import\s+(?:[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;

export function extractImportSpecifiers(code: string): string[] {
	const specifiers = new Set<string>();
	let match: RegExpExecArray | null;
	while ((match = IMPORT_RE.exec(code)) !== null) {
		specifiers.add(match[1]);
	}
	return [...specifiers];
}

/**
 * The cross-file graph. All mutations are plain data moves — nothing here
 * decides what to compile, who to invalidate, or where files come from.
 * `removeFile` returns the ids that fed on the removed module's edges so the
 * builder can recompile them.
 */
export class ProjectGraph {
	files = new Map<string, FileRecord>();
	/** target id → caller ids (for reactive-export propagation). */
	reverseImports = new Map<string, Set<string>>();
	/** target id → reactive export names (the importer-side input). */
	reactiveExports = new Map<string, string[]>();
	/** caller id → target id → { fn → reactive param indices }. */
	contributions = new Map<string, Map<string, Record<string, number[]>>>();
	/** target id → merged reactive call params (the target-side input). */
	mergedReactiveCalls = new Map<string, Record<string, number[]>>();

	/** The current output for one id, or null when the project has none. */
	output(id: string): ModuleOutput | null {
		return this.files.get(id)?.output ?? null;
	}

	has(id: string): boolean {
		return this.files.has(id);
	}

	/**
	 * Add (or replace) a file's source without compiling. Idempotent. Nulls
	 * the stale output and metadata — the source is the root of every
	 * invalidation, so the record forgets everything derived from it.
	 */
	setSource(id: string, source: string): void {
		const existing = this.files.get(id);
		if (existing) {
			existing.source = source;
			// Source changed — the compiled output and cached metadata are stale.
			existing.output = null;
			existing.importSpecifiers = extractImportSpecifiers(source);
			existing.resolvedTargets = new Map();
			existing.lastTargets = [];
			existing.analysis = null;
			existing.analysisKey = null;
			existing.outputKey = null;
		} else {
			this.files.set(id, {
				id,
				source,
				output: null,
				importSpecifiers: extractImportSpecifiers(source),
				resolvedTargets: new Map(),
				lastTargets: [],
				analysis: null,
				analysisKey: null,
				outputKey: null,
			});
		}
	}

	/**
	 * Drop a file and every edge that fed on it. Returns the ids that must be
	 * recompiled against the reduced graph: importers that lose its reactive
	 * exports, contribution targets that lose a caller, and files whose
	 * imports resolved to the removed id (they must re-resolve, unused now).
	 */
	removeFile(id: string): Set<string> {
		const affected = new Set<string>();
		const record = this.files.get(id);
		if (!record) return affected;
		this.files.delete(id);
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
		return affected;
	}
}