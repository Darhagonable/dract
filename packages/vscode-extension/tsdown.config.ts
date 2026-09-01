import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: {
			main: 'src/main.ts',
			server: 'src/server.ts',
		},
		format: 'cjs',
		fixedExtension: true,
		deps: {
			// vscode is provided by the extension host; everything else bundles
			// in because the VSIX ships no node_modules
			neverBundle: ['vscode'],
			alwaysBundle: [/./],
			onlyBundle: false,
		},
		alias: {
			// these packages resolve `main` to a UMD build whose AMD-factory
			// require array rolldown cannot statically rewrite — the surviving
			// runtime requires crashed the bundled server at boot. Their
			// `module` (ESM) builds bundle cleanly.
			'vscode-css-languageservice': 'vscode-css-languageservice/lib/esm/cssLanguageService.js',
			'vscode-html-languageservice': 'vscode-html-languageservice/lib/esm/htmlLanguageService.js',
		},
	},
	{
		entry: {
			browser: 'src/browser.ts',
		},
		format: 'cjs',
		platform: 'browser',
		fixedExtension: true,
		deps: {
			neverBundle: ['vscode'],
			alwaysBundle: [/./],
			onlyBundle: false,
		},
	},
]);
