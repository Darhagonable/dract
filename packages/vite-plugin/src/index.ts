import type { Plugin } from 'vite';
import { compile } from 'dartsx/compiler';
import fs from 'node:fs';

export interface DarTsxTransformContext {
	resolve(specifier: string, importer?: string): Promise<{ id: string } | null>;
	error(msg: string): never;
	environment: unknown;
}

function isDarTsxSource(code: string): boolean {
	// Strip comments and string literals to avoid false positives from JSDoc, etc.
	const sample = code.replace(
		/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
		(_, str) => str ?? ''
	);
	return /\bcomponent\s+\w+\s*\(/.test(sample)
		|| /\bstate\s+\w+\s*[=:]/.test(sample)
		|| /\bderived\s+\w+\s*[=:]/.test(sample)
		|| /\bderived\s+[{[]/.test(sample);
}

function extractImportSpecifiers(code: string): string[] {
	const specifiers = new Set<string>();
	const importRe = /import\s+(?:[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = importRe.exec(code)) !== null) {
		specifiers.add(match[1]);
	}
	return [...specifiers];
}

export interface DarTsxPluginOptions {
	/**
	 * CSS delivery mode.
	 * - `'injected'`: emit `$.style()` calls in JS (default)
	 * - `'external'`: extract CSS to separate `.css` files
	 */
	css?: 'injected' | 'external';
}

export default function dartsx(options: DarTsxPluginOptions = {}): Plugin {
	const cssMode = options.css || 'injected';
	/** Maps resolved module IDs to their reactive export names */
	const reactiveRegistry = new Map<string, string[]>();
	/** Maps virtual CSS module IDs to their CSS content (for external mode) */
	const cssModuleMap = new Map<string, string>();
	/**
	 * Per-caller reactive call contributions.
	 * Maps callerId → targetId → { fnName → indices }.
	 * This allows replacing a caller's contributions on recompile instead of only merging.
	 */
	const reactiveCallContributions = new Map<string, Map<string, Record<string, number[]>>>();
	/**
	 * Aggregated reactive call info per target module (derived from contributions).
	 * Maps resolved module IDs to reactive function param info.
	 * E.g. '/path/helper.ts' → { test: [0] } means test()'s param 0 receives a signal.
	 */
	const reactiveCallRegistry = new Map<string, Record<string, number[]>>();
	/** Guards against invalidation loops between mutually-importing files */
	const pendingInvalidations = new Set<string>();
	/** Cached import specifiers per module (avoids regex, populated from compile results) */
	const importSpecifierCache = new Map<string, string[]>();

	/**
	 * Rebuild the aggregated reactiveCallRegistry for a target by merging
	 * all caller contributions. Returns whether the result changed.
	 */
	function rebuildRegistryForTarget(targetId: string): boolean {
		const merged: Record<string, Set<number>> = {};
		for (const [, targets] of reactiveCallContributions) {
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

		const prev = reactiveCallRegistry.get(targetId);
		const prevJson = prev ? JSON.stringify(prev) : '';
		const newJson = JSON.stringify(result);

		if (prevJson === newJson) return false;

		if (Object.keys(result).length > 0) {
			reactiveCallRegistry.set(targetId, result);
		} else {
			reactiveCallRegistry.delete(targetId);
		}
		return true;
	}

	return {
		name: 'dartsx',
		enforce: 'pre',
		config() {
			return {
				optimizeDeps: {
					// DarTsx's custom .tsx syntax can't be parsed by Rolldown's dep scanner
					noDiscovery: true,
				},
			};
		},
		// Clean up registries when files are deleted or renamed
		handleHotUpdate({ modules }) {
			for (const mod of modules) {
				if (!mod.id) continue;
				if (!mod.file || !fs.existsSync(mod.file)) {
					reactiveRegistry.delete(mod.id);
					reactiveCallRegistry.delete(mod.id);
					reactiveCallContributions.delete(mod.id);
					importSpecifierCache.delete(mod.id);
				}
			}
		},
		resolveId(id) {
			// Resolve virtual CSS modules created in external mode
			if (cssModuleMap.has(id)) return id;
		},
		load(id) {
			// Serve virtual CSS module content
			const css = cssModuleMap.get(id);
			if (css !== undefined) return css;
		},
		async transform(code, id) {
			const isTsx = id.endsWith('.tsx');
			const isJsx = id.endsWith('.jsx');
			const isTs = id.endsWith('.ts') && !id.endsWith('.d.ts');
			const isJs = id.endsWith('.js') && !id.endsWith('.d.ts');

			// Compile JSX-flavored files eagerly, and plain TS/JS modules when they
			// contain DarTsx syntax or participate in reactive-call propagation.
			if (!isTsx && !isTs && !isJsx && !isJs) return;

			if (!isTsx && !isJsx && !reactiveCallRegistry.has(id) && !isDarTsxSource(code)) return;

			// Clear invalidation guard now that we're recompiling
			pendingInvalidations.delete(id);

			try {
				let reactiveImports: Record<string, string[]> | undefined;

				// Build reactiveImports from cached specifiers
				const specifiers = importSpecifierCache.get(id) ?? extractImportSpecifiers(code);
				if (specifiers?.length) {
					reactiveImports = {};
					for (const specifier of specifiers) {
						const resolved = await this.resolve(specifier, id);
						if (resolved) {
							let exports = reactiveRegistry.get(resolved.id);
							if (!exports && fs.existsSync(resolved.id)) {
								const importedSource = fs.readFileSync(resolved.id, 'utf-8');
								if (isDarTsxSource(importedSource)) {
									try {
										exports = compile(importedSource, { filename: resolved.id }).reactiveExports;
										if (exports.length > 0) reactiveRegistry.set(resolved.id, exports);
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

				const result = compile(code, {
					filename: id,
					css: cssMode,
					reactiveImports,
					reactiveCallImports: reactiveCallRegistry.get(id),
				});

				// Cache import specifiers for next compile (avoids regex on subsequent transforms)
				if (result.importSpecifiers.length > 0) {
					importSpecifierCache.set(id, result.importSpecifiers);
				} else {
					importSpecifierCache.delete(id);
				}

				// Store reactive exports in registry
				if (result.reactiveExports.length > 0) {
					reactiveRegistry.set(id, result.reactiveExports);
				} else {
					reactiveRegistry.delete(id);
				}

				// Update reactive call contributions for this caller and rebuild affected targets
				// First, collect this caller's new contributions
				const newContribs = new Map<string, Record<string, number[]>>();
				for (const [specifier, fns] of Object.entries(result.reactiveCalls)) {
					const resolved = await this.resolve(specifier, id);
					if (!resolved) continue;
					// Skip pre-built output directories — compiled library files handle
					// signals internally and must not be recompiled with reactive param
					// injection (injecting $.get() into e.g. the effect() definition breaks it).
					if (/[/\\]dist[/\\]/.test(resolved.id)) continue;
					newContribs.set(resolved.id, fns);
				}

				// Get the previous contributions from this caller
				const prevContribs = reactiveCallContributions.get(id);
				// Collect all target IDs that need rebuilding (union of old + new targets)
				const affectedTargets = new Set<string>();
				if (prevContribs) {
					for (const targetId of prevContribs.keys()) affectedTargets.add(targetId);
				}
				for (const targetId of newContribs.keys()) affectedTargets.add(targetId);

				// Replace this caller's contributions
				if (newContribs.size > 0) {
					reactiveCallContributions.set(id, newContribs);
				} else {
					reactiveCallContributions.delete(id);
				}

				// Rebuild the aggregated registry for each affected target and invalidate if changed
				for (const targetId of affectedTargets) {
					// Skip if this target is already pending invalidation (prevent loops)
					if (pendingInvalidations.has(targetId)) continue;

					const changed = rebuildRegistryForTarget(targetId);
					if (changed) {
						pendingInvalidations.add(targetId);
						const env = this.environment;
						if (env && typeof env === 'object' && 'moduleGraph' in env) {
							const mg = env.moduleGraph;
							if (mg && typeof mg === 'object' && 'getModuleById' in mg && typeof mg.getModuleById === 'function') {
								const mod = mg.getModuleById(targetId);
								if (mod && 'invalidateModule' in mg && typeof mg.invalidateModule === 'function') {
									mg.invalidateModule(mod);
								}
							}
						}
					}
				}

				let outputCode = result.code;

				// In external mode, append CSS as a virtual import so Vite can extract it
				if (cssMode === 'external' && result.css) {
					const cssId = id + '.css';
					cssModuleMap.set(cssId, result.css);
					outputCode += `\nimport ${JSON.stringify(cssId)};`;
				}

				return {
					code: outputCode,
					map: null,
				};
			} catch (e: any) {
				this.error(e.message);
			}
		},
	};
}
