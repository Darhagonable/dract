import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'dartsx-compiler',
		include: ['tests/compiler/**/*.test.ts'],
	},
});
