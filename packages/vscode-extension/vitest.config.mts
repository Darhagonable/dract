import { defineProject } from 'vitest/config';
import { vsCodeWorker } from 'vitest-environment-vscode';

export default defineProject({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		include: ['tests/*.test.ts'],
		pool: vsCodeWorker({
			version: 'stable',
			reuseWorker: true,
			launchArgs: ['--log', 'error', '--disable-gpu'],
		}),
		server: {
			deps: {
				external: [/^vscode$/],
			},
		},
	},
});
