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
