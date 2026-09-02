import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: {
			main: 'src/main.ts',
			server: 'src/server.ts',
		},
		format: 'cjs',
		deps: {
			// the language service is staged as node_modules/@dartsx/language-service
			// in the VSIX and shared with tsserver — require it at runtime, don't bundle
			neverBundle: ['vscode', '@dartsx/language-service'],
			alwaysBundle: [/./],
			onlyBundle: false,
		},
		alias: {
			// UMD `main` builds leave runtime `require` calls after bundling — alias to the ESM builds
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
		deps: {
			neverBundle: ['vscode'],
			alwaysBundle: [/./],
			onlyBundle: false,
		},
	},
]);
