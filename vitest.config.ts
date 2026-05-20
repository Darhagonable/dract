import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/dartsx/vitest.*.config.ts',
			'packages/typescript-plugin',
			'packages/vite-plugin',
			'packages/vscode-plugin',
			'toolkit/query',
		],
	},
});
