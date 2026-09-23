import { defineProject } from 'vitest/config';
import { vscodeExtensionHost } from '@gitbybit/vscode-extension-test-vitest-runner';

export default defineProject({
	plugins: [
		vscodeExtensionHost({
			extensionDevelopmentPath: '.',
			launchArgs: ['--log', 'error', '--disable-gpu'],
		}),
	],
	test: {
		include: ['tests/*.test.ts'],
		isolate: true,
	},
});
