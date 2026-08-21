import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
	},
	format: ['esm', 'cjs'],
	fixedExtension: false,
	deps: {
		neverBundle: ['typescript'],
	},
});