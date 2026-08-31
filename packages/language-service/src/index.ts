/**
 * DarTsx Language Service (Volar-based)
 *
 * Loaded into VS Code's built-in tsserver by the DarTsx VS Code extension
 * through its typescriptServerPlugins contribution — users never configure
 * it in tsconfig.json.
 * Transforms DarTsx .tsx files into valid TypeScript via the Volar framework,
 * providing intellisense, diagnostics, hover, completions, and navigation.
 *
 * Wraps Volar's Proxy-based service with an outer Proxy that intercepts
 * quick info (DarTsx-native hover terms, see hover.ts) and diagnostics
 * (false-positive filtering + unused-CSS warnings, see diagnostics.ts).
 */

import { createLanguageServicePlugin } from '@volar/typescript/lib/quickstart/createLanguageServicePlugin';
import { getDarTsxLanguagePlugin } from './language';
import { getQuickInfoWithDarTsxKeywords } from './hover';
import { filterDarTsxDiagnostics, getUnusedCssDiagnostics } from './diagnostics';

const baseInit = createLanguageServicePlugin(() => ({
	languagePlugins: [getDarTsxLanguagePlugin()],
}));

const init: typeof baseInit = (modules) => {
	const ts = modules.typescript;
	const base = baseInit(modules);
	return {
		...base,
		create(info) {
			const service = base.create(info);
			// Volar returns a Proxy whose get trap caches methods,
			// so property assignment doesn't stick. Wrap with our own Proxy.
			return new Proxy(service, {
				get(target, prop, receiver) {
					if (prop === 'getQuickInfoAtPosition') {
						return (fileName: string, position: number) => {
							return getQuickInfoWithDarTsxKeywords(target, fileName, position);
						};
					}
					if (prop === 'getSyntacticDiagnostics' || prop === 'getSemanticDiagnostics' || prop === 'getSuggestionDiagnostics') {
						const original = target[prop];
						return (fileName: string) => {
							let diags = original.call(target, fileName);
							diags = filterDarTsxDiagnostics(diags, fileName);
							if (prop === 'getSemanticDiagnostics') {
								diags = [...diags, ...getUnusedCssDiagnostics(fileName, ts)];
							}
							return diags;
						};
					}
					return Reflect.get(target, prop, receiver);
				},
			});
		},
	};
};

export = init;
