import type { Plugin } from 'vite';
import { Project } from 'dartsx/compiler';
import fs from 'node:fs';

export interface DarTsxTransformContext {
	resolve(specifier: string, importer?: string): Promise<{ id: string } | null>;
	error(msg: string): never;
	environment: unknown;
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
	/** Maps virtual CSS module IDs to their CSS content (for external mode) */
	const cssModuleMap = new Map<string, string>();
	/** Shared cross-file reactive tracking; lazily created on first transform */
	let project: Project | null = null;
	/** Guards one-time init so concurrent transforms share it */
	let initPromise: Promise<void> | null = null;
	/** Entry points from the resolved config (build mode; empty in dev) */
	let entryPoints: string[] = [];

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
		configResolved(config) {
			const input = config.build.rolldownOptions.input;
			if (typeof input === 'string') entryPoints = [input];
			else if (Array.isArray(input)) entryPoints = [...input];
			else if (input && typeof input === 'object') entryPoints = Object.values(input);
		},
		// Clean up project state when files are deleted or renamed
		handleHotUpdate({ modules }) {
			for (const mod of modules) {
				if (!mod.id) continue;
				if (!mod.file || !fs.existsSync(mod.file)) {
					project?.remove(mod.id);
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

			if (!isTsx && !isTs && !isJsx && !isJs) return;

			if (!project) {
				project = new Project({
					css: cssMode,
					entryPoints,
					resolve: async (specifier, importer) => {
						const resolved = await this.resolve(specifier, importer);
						if (!resolved) return null;
						return typeof resolved === 'string' ? resolved : resolved.id;
					},
					readFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null),
				});
				initPromise = project.init().finally(() => {
					initPromise = null;
				});
			}
			if (initPromise) await initPromise;

			const { changed } = await project.update(id, code);

			const output = project.output(id);
			if (!output) return;

			// Recompile modules whose reactive-call info changed (their outputs
			// are stale until re-transformed). The current module was just
			// updated, so it needs no invalidation.
			for (const otherId of changed) {
				if (otherId === id) continue;
				const env = this.environment;
				if (env && typeof env === 'object' && 'moduleGraph' in env) {
					const mg = env.moduleGraph;
					if (mg && typeof mg === 'object' && 'getModuleById' in mg && typeof mg.getModuleById === 'function') {
						const mod = mg.getModuleById(otherId);
						if (mod && 'invalidateModule' in mg && typeof mg.invalidateModule === 'function') {
							mg.invalidateModule(mod);
						}
					}
				}
			}

			let outputCode = output.code;

			// In external mode, append CSS as a virtual import so Vite can extract it
			if (cssMode === 'external' && output.css) {
				const cssId = id + '.css';
				cssModuleMap.set(cssId, output.css);
				outputCode += `\nimport ${JSON.stringify(cssId)};`;
			}

			return {
				code: outputCode,
				map: null,
			};
		},
	};
}
