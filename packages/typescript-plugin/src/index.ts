/**
 * DarTsx TypeScript Language Service Plugin (Volar-based)
 *
 * Loaded by tsserver when configured in tsconfig.json or through the VS Code
 * extension's typescriptServerPlugins contribution.
 *
 * All language logic lives in @dartsx/language; this package is only the
 * tsserver entry point that wires it up.
 */

import { createLanguageServicePlugin } from '@volar/typescript/lib/quickstart/createLanguageServicePlugin';
import {
	getDarTsxLanguagePlugin,
	getQuickInfoWithDarTsxKeywords,
	filterDarTsxDiagnostics,
	getUnusedCssDiagnostics,
} from '@dartsx/language';

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
