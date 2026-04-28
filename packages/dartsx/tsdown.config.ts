import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		'runtime/external/index': 'src/runtime/external/index.ts',
		'jsx-runtime': 'src/jsx-runtime.ts',
		'jsx-dev-runtime': 'src/jsx-dev-runtime.ts',
		'runtime/internal/client/index': 'src/runtime/internal/client/index.ts',
		'compiler/index': 'src/compiler/index.ts',
		'dartsx-to-tsx': 'src/dartsx-to-tsx.ts',
	},
	fixedExtension: false,
	external: ['oxc-parser', 'oxc-transform', 'postcss', 'postcss-selector-parser', 'zimmerframe', 'esrap', 'magic-string'],
});
