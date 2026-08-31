import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/dartsx/vitest.*.config.ts',
			'packages/language-service',
			'packages/vite-plugin',
			'packages/vscode-extension',
			'toolkit/query',
		],
	},
});
