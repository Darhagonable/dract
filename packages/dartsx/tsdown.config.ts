import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		'runtime/external/index': 'src/runtime/external/index.ts',
		'jsx-runtime': 'src/jsx-runtime.ts',
		'jsx-dev-runtime': 'src/jsx-dev-runtime.ts',
		'runtime/internal/client/index': 'src/runtime/internal/client/index.ts',
		'compiler/index': 'src/compiler/index.ts',
	},
	fixedExtension: false,
	external: ['oxc-parser', 'postcss', 'postcss-selector-parser'],
});
