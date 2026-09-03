import { defineProject } from 'vitest/config';
import dartsx from '@dartsx/vite-plugin';

export default defineProject({
	test: {
		name: 'dartsx',
		projects: [
			{
				plugins: [dartsx()],
				test: {
					name: 'client',
					include: ['tests/client/**/*.test.tsx'],
					environment: 'jsdom',
					setupFiles: ['tests/setup-client.js'],
				},
			},
			{
				test: {
					name: 'compiler',
					include: ['tests/compiler/**/*.test.ts'],
				},
			},
			{
				test: {
					name: 'dartsx-to-tsx',
					include: ['tests/dartsx-to-tsx.test.ts'],
				},
			},
		],
	},
});
