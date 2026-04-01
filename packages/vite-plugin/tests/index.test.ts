import { describe, expect, it } from 'vitest';
import dartsx from '../src/index';

describe('dartsx vite plugin', () => {
	it('transforms DarTsx JSX files in JavaScript projects', async () => {
		const plugin = dartsx();
		const transform = plugin.transform;
		if (!transform) {
			throw new Error('Expected vite plugin transform hook');
		}

		const result = await transform.call({
			resolve: async () => null,
			error(message: string) {
				throw new Error(message);
			},
		}, 'export default component Counter() { render (<div>Hello</div>) }', '/src/Counter.jsx');

		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
		expect((result as { code: string }).code).toContain('function Counter');
	});

	it('ignores plain JavaScript files without DarTsx syntax', async () => {
		const plugin = dartsx();
		const transform = plugin.transform;
		if (!transform) {
			throw new Error('Expected vite plugin transform hook');
		}

		const result = await transform.call({
			resolve: async () => null,
			error(message: string) {
				throw new Error(message);
			},
		}, 'export const count = 1;', '/src/plain.js');

		expect(result).toBeUndefined();
	});
});
