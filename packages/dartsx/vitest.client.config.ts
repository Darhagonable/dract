import { defineProject } from 'vitest/config';
import dartsx from '@dartsx/vite-plugin';

export default defineProject({
	plugins: [dartsx()],
	test: {
		name: 'dartsx-client',
		include: ['tests/client/**/*.test.tsx'],
		environment: 'jsdom',
		setupFiles: ['tests/setup-client.js'],
	},
});
