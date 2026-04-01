import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['packages/dartsx/tests/*.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'runtime',
					include: ['packages/dartsx/tests/runtime-tests/index.test.js'],
					environment: 'jsdom',
				},
			},
			{
				extends: true,
				test: {
					name: 'typescript-plugin',
					include: ['packages/typescript-plugin/tests/*.test.ts'],
				},
			},
		],
	},
});
