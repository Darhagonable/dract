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
				});
			}

			const result = await project.update(id, code, {
				resolve: async (specifier, importer) => {
					const resolved = await this.resolve(specifier, importer);
					if (!resolved) return null;
					return typeof resolved === 'string' ? resolved : resolved.id;
				},
				readFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null),
			});

			if (!result) return;

			// Recompile modules whose reactive-call info changed
			for (const targetId of result.invalidated) {
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
		},
	};
}