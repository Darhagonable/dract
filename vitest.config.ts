import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/dartsx',
			'packages/language-service',
			'packages/vite-plugin',
			'packages/vscode-extension',
			'toolkit/query',
		],
	},
});
