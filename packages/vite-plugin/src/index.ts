import type { Plugin } from 'vite';
import { ProjectCompiler } from 'dartsx/compiler';
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

	// The ProjectCompiler owns the whole cross-file graph (reactive exports,
	// call contributions, incremental invalidation). This plugin is a thin
	// adapter: files enter through transform(), neighbors are pulled from disk
	// through loadFile(), and recompiled neighbors are nudged in the module
	// graph so Vite re-requests them. Bare specifiers carry no cross-file
	// metadata, so they resolve to nothing here.
	const project = new ProjectCompiler({
		css: cssMode,
		resolveExternal: () => null,
		loadFile: (id) => (fs.existsSync(id) ? fs.readFileSync(id, 'utf-8') : null),
	});

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
		// Drop files from the graph when they are deleted or renamed
		handleHotUpdate({ modules }) {
			for (const mod of modules) {
				if (!mod.id) continue;
				if (!mod.file || !fs.existsSync(mod.file)) {
					project.removeFile(mod.id);
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
			// contain DarTsx syntax or have entered the project (e.g. because a
			// DarTsx file imports them and reactive-call propagation needs them).
			if (!isTsx && !isTs && !isJsx && !isJs) return;

			if (!isTsx && !isJsx && !project.hasFile(id) && !isDarTsxSource(code)) return;

			let update;
			try {
				update = project.updateFile(id, code);
			} catch (e: any) {
				this.error(e.message);
			}

			const output = update!.outputs[id];
			if (!output) return;

			// Neighbors the project recompiled (importers, callees) must be
			// re-requested so Vite picks up their new output.
			const env = this.environment;
			if (env && typeof env === 'object' && 'moduleGraph' in env) {
				const mg = env.moduleGraph;
				if (mg && typeof mg === 'object' && 'getModuleById' in mg && typeof mg.getModuleById === 'function') {
					for (const otherId of update!.changed) {
						if (otherId === id) continue;
						const mod = mg.getModuleById(otherId);
						if (mod && 'invalidateModule' in mg && typeof mg.invalidateModule === 'function') {
							mg.invalidateModule(mod);
						}
					}
				}
			}

			let outputCode = output.js.code;

			// In external mode, append CSS as a virtual import so Vite can extract it
			if (cssMode === 'external' && output.css.code) {
				const cssId = id + '.css';
				cssModuleMap.set(cssId, output.css.code);
				outputCode += `\nimport ${JSON.stringify(cssId)};`;
			}

			return {
				code: outputCode,
				map: null,
			};
		},
	};
}
