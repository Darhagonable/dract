import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		server: 'src/server.ts',
	},
	format: 'cjs',
	fixedExtension: false,
	deps: {
		neverBundle: ['vscode'],
	},
});
