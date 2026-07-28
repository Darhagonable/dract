import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: 'cjs',
	fixedExtension: false,
	clean: false,
	outDir: 'dist',
	deps: {
		alwaysBundle: [/./],
		neverBundle: ['typescript'],
	},
});
