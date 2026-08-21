import { defineProject } from 'vitest/config';

export default defineProject({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		name: 'dartsx-compiler',
		include: ['tests/compiler/**/*.test.ts'],
	},
});
