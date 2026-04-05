import { defineConfig } from 'vitest/config';
import dartsx from './packages/vite-plugin/src/index';
import path from 'path';

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'compiler',
					include: ['packages/dartsx/tests/compiler/**/*.test.ts'],
				},
			},
			{
				plugins: [dartsx()],
				resolve: {
					alias: {
						'dartsx/internal/client': path.resolve(__dirname, 'packages/dartsx/src/runtime/internal/client/index.ts'),
						'dartsx': path.resolve(__dirname, 'packages/dartsx/src/runtime/external/index.ts'),
					},
				},
				test: {
					name: 'client',
					include: ['packages/dartsx/tests/client/**/*.test.tsx'],
					environment: 'jsdom',
					setupFiles: ['packages/dartsx/tests/setup-client.js'],
					globals: true,
				},
			},
			{
				extends: true,
				test: {
					name: 'typescript-plugin',
					include: ['packages/typescript-plugin/tests/*.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'vite-plugin',
					include: ['packages/vite-plugin/tests/*.test.ts'],
				},
			},
		],
	},
});
