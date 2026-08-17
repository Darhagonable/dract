import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/dartsx',
			'packages/typescript-plugin',
			'packages/vite-plugin',
			'packages/vscode-extension',
			'toolkit/query',
		],
	},
});
