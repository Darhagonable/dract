import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: {
			main: 'src/main.ts',
			server: 'src/server.ts',
		},
		format: 'cjs',
		fixedExtension: false,
		deps: {
			neverBundle: ['vscode'],
		},
	},
	{
		entry: {
			browser: 'src/browser.ts',
		},
		format: 'cjs',
		platform: 'browser',
		fixedExtension: false,
		deps: {
			neverBundle: ['vscode'],
		},
	},
]);
