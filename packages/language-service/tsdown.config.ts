import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		language: 'src/language.ts',
		'unused-css': 'src/unused-css.ts',
		diagnostics: 'src/diagnostics.ts',
	},
	format: 'cjs',
	fixedExtension: false,
	deps: {
		// tsserver provides its own TypeScript — everything else bundles in
		// so the module ships self-contained inside the VS Code extension VSIX
		neverBundle: ['typescript'],
		alwaysBundle: [/^@volar\//, /^dartsx/],
		onlyBundle: false,
	},
});
