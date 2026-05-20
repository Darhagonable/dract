import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'dartsx-to-tsx',
		include: ['tests/dartsx-to-tsx.test.ts'],
	},
});
