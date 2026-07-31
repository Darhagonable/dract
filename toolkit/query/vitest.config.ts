import { defineConfig } from 'vitest/config';
import dartsx from '@dartsx/vite-plugin';

export default defineConfig({
	plugins: [dartsx()],
	test: {
		include: ['tests/*.test.tsx'],
		environment: 'jsdom',
	},
});
