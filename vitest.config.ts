import { configDefaults, defineConfig } from 'vitest/config';
import dartsx from 'dartsx-vite-plugin';

export default defineConfig({
	plugins: [dartsx()],
	test: {
		...configDefaults,
		projects: [
			{
				test: {
					name: 'compiler',
					include: ['packages/dartsx/tests/compiler/**/*.test.ts'],
				},
			},
			{
				test: {
					name: 'dartsx-to-tsx',
					include: ['packages/dartsx/tests/dartsx-to-tsx.test.ts'],
				},
			},
			{
				plugins: [dartsx()],
				test: {
					name: 'client',
					include: ['packages/dartsx/tests/client/**/*.test.tsx'],
					environment: 'jsdom',
					setupFiles: ['packages/dartsx/tests/setup-client.js'],
					globals: true,
				},
			},
			{
				test: {
					name: 'typescript-plugin',
					include: ['packages/typescript-plugin/tests/*.test.ts'],
				},
			},
			{
				test: {
					name: 'vite-plugin',
					include: ['packages/vite-plugin/tests/*.test.ts'],
				},
			},
			{
				plugins: [dartsx()],
				test: {
					name: 'query',
					include: ['toolkit/query/tests/*.test.tsx'],
					environment: 'jsdom',
					setupFiles: ['packages/dartsx/tests/setup-client.js'],
					globals: true,
				},
			},
		],
	},
});
