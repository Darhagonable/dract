/**
 * Project — cross-file reactive compilation state
 *
 * The single-file `compile()` entry point is tooling-agnostic but knows nothing
 * about how modules relate. `Project` adds the cross-file layer on top:
 * - which modules export reactive bindings (state/derived)
 * - which imported functions receive reactive arguments at call sites
 * - which modules need recompilation when that information changes
 *
 * It also owns the compiled outputs: tools feed modules in through `update()`
 * and read results back with `output()`. It is deliberately free of bundler
 * APIs. The tool (Vite plugin, CLI, etc.) injects `resolve`/`readFile` hooks
 * per update so the project can discover imported modules and inspect their
 * sources.
 */
import { compile } from './index';
import { isDarTsxFile } from './phases/1-preprocess';
import type { SourceMap } from '@jridgewell/remapping';

export interface ProjectOptions {
	/**
	 * CSS delivery mode, forwarded to `compile`.
	 * - `'injected'`: emit `$.style()` calls in JS (default)
	 * - `'external'`: omit `$.style()` calls, collect CSS for external delivery
	 */
	css?: 'injected' | 'external';
}

/** Bundler-agnostic hooks supplied by the tool per update. */
export interface ProjectHooks {
	/** Resolve an import specifier (as seen in `importer`) to a module id. */
	resolve(specifier: string, importer: string): Promise<string | null> | string | null;
	/** Read a module's source, used to inspect imports whose exports aren't cached. */
	readFile(id: string): Promise<string | null> | string | null;
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
 * tracking: reactive exports, reactive call propagation, and the invalidation
 * decisions that follow from both.
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

	private css: 'injected' | 'external';

	constructor(options: ProjectOptions = {}) {
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
	 * Returns the ids whose outputs changed by this call: the module itself
	 * (fresh output) plus any modules whose reactive-call information changed
	 * (their stored outputs are stale until the tool re-transforms them).
	 */
	async update(filename: string, source: string, hooks: ProjectHooks): Promise<string[]> {
		// JSX-flavored files compile eagerly. Plain TS/JS modules compile only
		// when they contain DarTsx syntax or participate in reactive-call
		// propagation. A module that stops qualifying drops its stale output.
		const isTsx = filename.endsWith('.tsx');
		const isJsx = filename.endsWith('.jsx');
		if (!isTsx && !isJsx && !this.reactiveCallRegistry.has(filename) && !isDarTsxFile(source)) {
			this.outputs.delete(filename);
			return [];
		}

		// Clear invalidation guard now that we're recompiling
		this.pendingInvalidations.delete(filename);

		let reactiveImports: Record<string, string[]> | undefined;

		// Build reactiveImports from cached specifiers
		const specifiers = this.importSpecifierCache.get(filename) ?? extractImportSpecifiers(source);
		if (specifiers?.length) {
			reactiveImports = {};
			for (const specifier of specifiers) {
				const resolved = await hooks.resolve(specifier, filename);
				if (resolved) {
					let exports = this.reactiveRegistry.get(resolved);
					if (!exports && hooks.readFile) {
						const importedSource = await hooks.readFile(resolved);
						if (importedSource && isDarTsxFile(importedSource)) {
							try {
								exports = compile(importedSource, { filename: resolved }).metadata.reactiveExports;
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

		const result = compile(source, {
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

		// Store reactive exports in registry
		if (result.metadata.reactiveExports.length > 0) {
			this.reactiveRegistry.set(filename, result.metadata.reactiveExports);
		} else {
			this.reactiveRegistry.delete(filename);
		}

		// Update reactive call contributions for this caller and rebuild affected targets.
		// First, collect this caller's new contributions
		const newContribs = new Map<string, Record<string, number[]>>();
		for (const [specifier, fns] of Object.entries(result.metadata.reactiveCalls)) {
			const resolved = await hooks.resolve(specifier, filename);
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

		this.outputs.set(filename, {
			code: result.js.code,
			map: result.js.map,
			css: result.css.code || null,
		});

		return [filename, ...stale];
	}

	/**
	 * Forget a module (e.g. its file was deleted or renamed).
	 */
	remove(filename: string): void {
		this.outputs.delete(filename);
		this.reactiveRegistry.delete(filename);
		this.reactiveCallRegistry.delete(filename);
		this.reactiveCallContributions.delete(filename);
		this.importSpecifierCache.delete(filename);
		this.pendingInvalidations.delete(filename);
	}
}