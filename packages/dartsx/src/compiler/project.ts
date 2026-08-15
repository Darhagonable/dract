/**
 * Project — cross-file reactive compilation state
 *
 * The single-file `compileModule()` entry point is tooling-agnostic but knows nothing
 * about how modules relate. `Project` adds the cross-file layer on top:
 * - which modules export reactive bindings (state/derived)
 * - which imported functions receive reactive arguments at call sites
 * - which modules need recompilation when that information changes
 *
 * The project owns its environment: the tool supplies a `host` (module
 * resolution + source loading) once at construction, and `update()` is called
 * per module change. It also owns the compiled outputs: tools read results
 * back with `output()` and act on the `changed` ids they receive.
 *
 * Tools that know their entry points call `init()`, which discovers and
 * compiles the whole reachable import graph without further supervision.
 */
import { compileModule } from './index';
import { isDarTsxFile } from './phases/1-preprocess';
import type { SourceMap } from '@jridgewell/remapping';

/** Bundler-agnostic environment supplied by the tool. */
export interface ProjectHost {
	/** Resolve an import specifier (as seen in `importer`) to a module id. */
	resolve(
		specifier: string,
		importer: string,
	): string | undefined | Promise<string | undefined>;
	/** Read a module's source, or undefined when the module doesn't exist. */
	readFile(id: string): string | undefined | Promise<string | undefined>;
}

export interface ProjectOptions {
	/**
	 * Entry points for `init()`. Tools that feed modules in themselves (e.g. a
	 * Vite plugin in dev mode) can pass `[]` and drive the project purely
	 * through `update()`.
	 */
	entryPoints: string[];
	/**
	 * CSS delivery mode, forwarded to `compileModule`.
	 * - `'injected'`: emit `$.style()` calls in JS (default)
	 * - `'external'`: omit `$.style()` calls, collect CSS for external delivery
	 */
	css?: 'injected' | 'external';
	/** The environment the project reads its modules through. */
	host: ProjectHost;
}

/** The compiled output of one module, owned by the project. */
export interface ModuleOutput {
	/** The compiled JavaScript. */
	code: string;
	/** Source map from output positions to original source positions. */
	map: SourceMap | null;
	/** Collected CSS (external mode only); null when no style blocks compiled. */
	css: string | null;
}

/** Result of an `update()` call. */
export interface ProjectUpdate {
	/**
	 * Module ids whose outputs changed: the updated module itself plus any
	 * modules whose reactive information changed under them (their stored
	 * outputs are stale until the tool re-transforms them).
	 */
	changed: string[];
}

/**
 * Extract import specifiers from source without parsing (used when the
 * compiled metadata cache has no entry yet).
 */
function extractImportSpecifiers(code: string): string[] {
	const specifiers = new Set<string>();
	const importRe = /import\s+(?:[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = importRe.exec(code)) !== null) {
		specifiers.add(match[1]);
	}
	return [...specifiers];
}

/**
 * A collection of DarTsx modules compiled together, with cross-file reactive
 * tracking: reactive exports, reactive call propagation, the dependency graph,
 * and the invalidation decisions that follow from all of them.
 */
export class Project {
	/** Maps resolved module IDs to their reactive export names */
	private reactiveRegistry = new Map<string, string[]>();
	/**
	 * Per-caller reactive call contributions.
	 * Maps callerId → targetId → { fnName → indices }.
	 * Replaces a caller's contributions on recompile instead of only merging.
	 */
	private reactiveCallContributions = new Map<string, Map<string, Record<string, number[]>>>();
	/**
	 * Aggregated reactive call info per target module (derived from contributions).
	 * Maps resolved module IDs to reactive function param info.
	 * E.g. '/path/helper.ts' → { test: [0] } means test()'s param 0 receives a signal.
	 */
	private reactiveCallRegistry = new Map<string, Record<string, number[]>>();
	/** Guards against invalidation loops between mutually-importing files */
	private pendingInvalidations = new Set<string>();
	/** Cached import specifiers per module (avoids regex, populated from compile results) */
	private importSpecifierCache = new Map<string, string[]>();
	/** Compiled outputs, owned by the project and read by the tool. */
	private outputs = new Map<string, ModuleOutput>();
	/** All module ids the project knows about. */
	private modulesSet = new Set<string>();
	/** Resolved import edges: module id → ids it imports. */
	private dependencies = new Map<string, string[]>();
	/** Reverse edges: module id → ids that import it. */
	private importers = new Map<string, Set<string>>();

	private host: ProjectHost;
	private entryPoints: string[];
	private css: 'injected' | 'external';

	constructor(options: ProjectOptions) {
		this.host = options.host;
		this.entryPoints = options.entryPoints;
		this.css = options.css || 'injected';
	}

	/**
	 * Rebuild the aggregated reactiveCallRegistry for a target by merging
	 * all caller contributions. Returns whether the result changed.
	 */
	private rebuildRegistryForTarget(targetId: string): boolean {
		const merged: Record<string, Set<number>> = {};
		for (const [, targets] of this.reactiveCallContributions) {
			const contrib = targets.get(targetId);
			if (!contrib) continue;
			for (const [fnName, indices] of Object.entries(contrib)) {
				if (!merged[fnName]) merged[fnName] = new Set();
				for (const idx of indices) merged[fnName].add(idx);
			}
		}

		// Convert to sorted arrays for stable comparison
		const result: Record<string, number[]> = {};
		for (const [fnName, indices] of Object.entries(merged)) {
			result[fnName] = [...indices].sort();
		}

		const prev = this.reactiveCallRegistry.get(targetId);
		const prevJson = prev ? JSON.stringify(prev) : '';
		const newJson = JSON.stringify(result);

		if (prevJson === newJson) return false;

		if (Object.keys(result).length > 0) {
			this.reactiveCallRegistry.set(targetId, result);
		} else {
			this.reactiveCallRegistry.delete(targetId);
		}
		return true;
	}

	/**
	 * Replace a module's dependency edges, keeping the importers map in sync.
	 * Also registers newly discovered modules.
	 */
	private replaceEdges(filename: string, deps: string[]) {
		const prevDeps = this.dependencies.get(filename) ?? [];
		for (const dep of prevDeps) {
			const importers = this.importers.get(dep);
			if (importers) {
				importers.delete(filename);
				if (importers.size === 0) this.importers.delete(dep);
			}
		}
		this.dependencies.set(filename, deps);
		for (const dep of deps) {
			if (dep === filename) continue;
			if (!this.importers.has(dep)) this.importers.set(dep, new Set());
			this.importers.get(dep)!.add(filename);
			this.modulesSet.add(dep);
		}
	}

	/**
	 * Drop a caller's reactive-call contributions and rebuild the aggregated
	 * registry for every target that received them. Returns the ids whose
	 * registry changed (their outputs are stale until re-transformed).
	 */
	private dropContributions(callerId: string): string[] {
		const contribs = this.reactiveCallContributions.get(callerId);
		this.reactiveCallContributions.delete(callerId);
		if (!contribs) return [];
		const changed: string[] = [];
		for (const targetId of contribs.keys()) {
			if (this.pendingInvalidations.has(targetId)) continue;
			if (this.rebuildRegistryForTarget(targetId)) {
				this.pendingInvalidations.add(targetId);
				changed.push(targetId);
			}
		}
		return changed;
	}

	/**
	 * Discover and initially compile the project from its entry points.
	 *
	 * Walks the import graph via the `host`: each module is compiled with
	 * `update()`, then its changed neighbours and newly discovered dependencies
	 * are compiled in turn until the graph converges.
	 */
	async init(): Promise<void> {
		let worklist = new Set(this.entryPoints);
		while (worklist.size > 0) {
			const next = new Set<string>();
			for (const id of worklist) {
				const source = await this.host.readFile(id);
				if (source === undefined) {
					this.remove(id);
					continue;
				}
				const { changed } = await this.update(id, source);
				for (const other of changed) {
					if (other === id) continue;
					next.add(other);
				}
				for (const dep of this.dependencies.get(id) ?? []) {
					if (!this.outputs.has(dep)) next.add(dep);
				}
			}
			worklist = next;
		}
	}

	/**
	 * The current compiled output for a module, or null when the project has
	 * none (module not compiled or no longer part of the project).
	 */
	output(id: string): ModuleOutput | null {
		return this.outputs.get(id) ?? null;
	}

	/**
	 * Compile (or recompile) a module and update cross-file tracking.
	 *
	 * The output is stored in the project and read back via `output()`.
	 * The returned `changed` ids are the module itself (fresh output) plus any
	 * modules whose outputs are now stale: targets of the module's reactive
	 * calls and importers of its reactive exports.
	 */
	async update(filename: string, source: string): Promise<ProjectUpdate> {
		this.pendingInvalidations.delete(filename);
		this.modulesSet.add(filename);

		// JSX-flavored files compile eagerly. Plain TS/JS modules compile only
		// when they contain DarTsx syntax or participate in reactive-call
		// propagation. A module that stops qualifying drops its stale output.
		const isTsx = filename.endsWith('.tsx');
		const isJsx = filename.endsWith('.jsx');
		if (!isTsx && !isJsx && !this.reactiveCallRegistry.has(filename) && !isDarTsxFile(source)) {
			this.outputs.delete(filename);
			this.replaceEdges(filename, []);
			return { changed: [] };
		}

		let reactiveImports: Record<string, string[]> | undefined;

		// Build reactiveImports from cached specifiers
		const specifiers = this.importSpecifierCache.get(filename) ?? extractImportSpecifiers(source);
		const deps = new Set<string>();
		if (specifiers?.length) {
			reactiveImports = {};
			for (const specifier of specifiers) {
				const resolved = await this.host.resolve(specifier, filename);
				if (resolved) {
					deps.add(resolved);
					let exports = this.reactiveRegistry.get(resolved);
					if (!exports) {
						const importedSource = await this.host.readFile(resolved);
						if (importedSource && isDarTsxFile(importedSource)) {
							try {
								exports = compileModule(importedSource, { filename: resolved }).metadata.reactiveExports;
								if (exports.length > 0) this.reactiveRegistry.set(resolved, exports);
							} catch {
								// Ignore inspection failures and continue without reactive import info.
							}
						}
					}
					if (exports?.length) {
						reactiveImports[specifier] = exports;
					}
				}
			}
		}
		this.replaceEdges(filename, [...deps]);

		const result = compileModule(source, {
			filename,
			css: this.css,
			reactiveImports,
			reactiveCallImports: this.reactiveCallRegistry.get(filename),
		});

		// Cache import specifiers for next compile (avoids regex on subsequent updates)
		if (result.metadata.importSpecifiers.length > 0) {
			this.importSpecifierCache.set(filename, result.metadata.importSpecifiers);
		} else {
			this.importSpecifierCache.delete(filename);
		}

		// Store reactive exports in registry, remembering the previous surface
		const prevExports = this.reactiveRegistry.get(filename) ?? [];
		if (result.metadata.reactiveExports.length > 0) {
			this.reactiveRegistry.set(filename, result.metadata.reactiveExports);
		} else {
			this.reactiveRegistry.delete(filename);
		}

		// Update reactive call contributions for this caller and rebuild affected targets.
		// First, collect this caller's new contributions
		const newContribs = new Map<string, Record<string, number[]>>();
		for (const [specifier, fns] of Object.entries(result.metadata.reactiveCalls)) {
			const resolved = await this.host.resolve(specifier, filename);
			if (!resolved) continue;
			// Skip pre-built output directories — compiled library files handle
			// signals internally and must not be recompiled with reactive param
			// injection (injecting $.get() into e.g. the effect() definition breaks it).
			if (/[/\\]dist[/\\]/.test(resolved)) continue;
			newContribs.set(resolved, fns);
		}

		// Get the previous contributions from this caller
		const prevContribs = this.reactiveCallContributions.get(filename);
		// Collect all target IDs that need rebuilding (union of old + new targets)
		const affectedTargets = new Set<string>();
		if (prevContribs) {
			for (const targetId of prevContribs.keys()) affectedTargets.add(targetId);
		}
		for (const targetId of newContribs.keys()) affectedTargets.add(targetId);

		// Replace this caller's contributions
		if (newContribs.size > 0) {
			this.reactiveCallContributions.set(filename, newContribs);
		} else {
			this.reactiveCallContributions.delete(filename);
		}

		// Rebuild the aggregated registry for each affected target and collect
		// the ones that changed — their outputs are stale until re-transformed.
		const stale: string[] = [];
		for (const targetId of affectedTargets) {
			// Skip if this target is already pending invalidation (prevent loops)
			if (this.pendingInvalidations.has(targetId)) continue;

			const changed = this.rebuildRegistryForTarget(targetId);
			if (changed) {
				this.pendingInvalidations.add(targetId);
				stale.push(targetId);
			}
		}

		// If this module's reactive export surface changed, its importers must
		// recompile — they were compiled against the old surface.
		if (prevExports.join(',') !== result.metadata.reactiveExports.join(',')) {
			const importers = this.importers.get(filename);
			if (importers) {
				for (const importer of importers) {
					if (importer === filename || this.pendingInvalidations.has(importer)) continue;
					this.pendingInvalidations.add(importer);
					stale.push(importer);
				}
			}
		}

		this.outputs.set(filename, {
			code: result.js.code,
			map: result.js.map,
			css: result.css.code || null,
		});

		return { changed: [filename, ...stale] };
	}

	/**
	 * Forget a module (e.g. its file was deleted or renamed). Returns the ids
	 * whose outputs are now stale (targets that received reactive-call
	 * contributions from the removed module).
	 */
	remove(filename: string): ProjectUpdate {
		this.outputs.delete(filename);
		this.reactiveRegistry.delete(filename);
		this.reactiveCallRegistry.delete(filename);
		this.importSpecifierCache.delete(filename);
		this.pendingInvalidations.delete(filename);
		this.modulesSet.delete(filename);
		this.replaceEdges(filename, []);
		return { changed: this.dropContributions(filename) };
	}

	/**
	 * The ids of all modules the project currently knows about.
	 */
	modules(): string[] {
		return [...this.modulesSet];
	}
}
