import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/dartsx/vitest.*.config.ts',
			'packages/language',
			'packages/typescript-plugin',
			'packages/vite-plugin',
			'packages/vscode-extension',
			'toolkit/query',
		],
	},
});
