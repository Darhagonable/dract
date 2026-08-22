import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		language: 'src/language.ts',
		'unused-css': 'src/unused-css.ts',
	},
	format: 'cjs',
	fixedExtension: false,
	deps: {
		neverBundle: ['typescript'],
	},
});
