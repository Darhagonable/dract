import { defineProject } from 'vitest/config';
import { vsCodeWorker } from 'vitest-environment-vscode';

export default defineProject({
	test: {
		include: ['tests/*.test.ts'],
		pool: vsCodeWorker({
			version: 'stable',
			reuseWorker: true,
		}),
		server: {
			deps: {
				external: [/^vscode$/],
			},
		},
	},
});
