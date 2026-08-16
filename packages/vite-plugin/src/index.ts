import type { Plugin, TransformResult } from 'vite';
import { Project, type ModuleOutput } from 'dartsx/compiler';
import fs from 'node:fs';

export interface DarTsxPluginOptions {
	/**
	 * CSS delivery mode.
	 * - `'injected'`: emit `$.style()` calls in JS (default)
	 * - `'external'`: extract CSS to separate `.css` files
	 */
	css?: 'injected' | 'external';
	/**
	 * Additional entry points for `Project.init()`. The plugin also extracts
	 * vite's build input in `buildStart`; dev mode is update-driven.
	 */
	entryPoints?: string[];
}

/** Whether a module id should be processed as DarTsx. */
function isCompilable(id: string): boolean {
	const isTs = id.endsWith('.ts') && !id.endsWith('.d.ts');
	const isJs = id.endsWith('.js') && !id.endsWith('.d.ts');
	return id.endsWith('.tsx') || id.endsWith('.jsx') || isTs || isJs;
}

/**
 * Invalidate modules in a vite module graph. Works with both the legacy
 * combined `ModuleGraph` and per-environment `EnvironmentModuleGraph`.
 */
function invalidateModules(
	graph: {
		getModuleById(id: string): { id: string | null } | undefined;
		invalidateModule(mod: { id: string | null }): void;
	},
	ids: string[],
) {
	for (const id of ids) {
		const mod = graph.getModuleById(id);
		if (mod) graph.invalidateModule(mod);
	}
}

/** Append an import for a virtual CSS module and register its content. */
function appendCssImport(
	cssModuleMap: Map<string, string>,
	code: string,
	id: string,
	css: string,
): string {
	const cssId = `${id}.css`;
	cssModuleMap.set(cssId, css);
	return `${code}\nimport ${JSON.stringify(cssId)};`;
}

/**
 * Adapt a compiler source map to vite's `TransformResult['map']`. The
 * compiler's maps are runtime-compatible plain objects; rolldown merely types
 * source maps as classes with `toUrl`/`toString` methods, which vite handles
 * on method-less objects at runtime.
 */
function toViteSourceMap(map: ModuleOutput['js']['map']): TransformResult['map'] {
	if (map == null) return null;
	return map as TransformResult['map'];
}

export default function dartsx(options: DarTsxPluginOptions = {}): Plugin {
	const cssMode = options.css || 'injected';
	/** Maps virtual CSS module IDs to their CSS content (for external mode) */
	const cssModuleMap = new Map<string, string>();
	/** Shared cross-file reactive tracking; created in `buildStart` */
	let project: Project;

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
		async buildStart() {
			// Determine entry points: vite's build input (defaults to index.html,
			// which `init()` resolves through vite) plus any explicit options.
			const input = this.environment.config.build.rolldownOptions.input;
			let entries: string[] = [];
			if (typeof input === 'string') entries = [input];
			else if (Array.isArray(input)) entries = [...input];
			else if (input && typeof input === 'object') entries = Object.values(input);
			entries = [...new Set([...entries, ...(options.entryPoints ?? [])])];

			project = new Project({
				css: cssMode,
				entryPoints: entries,
				host: {
					resolve: async (specifier, importer) => {
						const resolved = await this.resolve(specifier, importer);
						if (!resolved) return undefined;
						return typeof resolved === 'string' ? resolved : resolved.id;
					},
					readFile: (file) => {
						try {
							return fs.readFileSync(file, 'utf8');
						} catch {
							return undefined;
						}
					},
				},
			});
			await project.init();
		},
		// Clean up project state when files are deleted or renamed, and
		// invalidate modules whose reactive info the removal changed.
		handleHotUpdate({ modules, server }) {
			if (!project) throw new Error('dartsx: project not initialized (buildStart did not run)');
			for (const mod of modules) {
				if (!mod.id || !mod.file) continue;
				if (!fs.existsSync(mod.file)) {
					const { invalidated } = project.remove(mod.id);
					invalidateModules(server.moduleGraph, invalidated);
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
			if (!isCompilable(id)) return;
			if (!project) throw new Error('dartsx: project not initialized (buildStart did not run)');

			const { invalidated } = await project.update(id, code);

			// Recompile modules whose reactive information changed (their
			// outputs are stale until re-transformed). Build mode needs no
			// invalidation — `init()` pre-compiled the graph with final info.
			if (this.environment.mode === 'dev') {
				invalidateModules(this.environment.moduleGraph, invalidated);
			}

			const output = project.output(id);
			if (!output) return;

			let outputCode = output.js.code;
			let map = toViteSourceMap(output.js.map);

			// In external mode, append CSS as a virtual import so Vite can extract it
			if (cssMode === 'external' && output.css.code != null) {
				outputCode = appendCssImport(cssModuleMap, outputCode, id, output.css.code);
				// The appended CSS import would misalign the map, so drop it then
				map = null;
			}

			return {
				code: outputCode,
				map,
			};
		},
	};
}
