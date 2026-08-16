import { describe, expect, it, vi } from 'vitest';
import dartsx from '../src/index';

/** Minimal context for `buildStart`: resolve is captured by the Project host. */
function buildStartCtx(resolve: (specifier: string) => unknown, input: unknown) {
	return {
		resolve: async (specifier: string) => resolve(specifier),
		environment: {
			config: { build: { rolldownOptions: { input } } },
		},
	} as never;
}

describe('dartsx vite plugin', () => {
	it('transforms DarTsx JSX files in JavaScript projects', async () => {
		const plugin = dartsx();
		await plugin.buildStart!.call(buildStartCtx(() => null, undefined));

		const result = await plugin.transform!.call({
			environment: { mode: 'build' },
		}, 'export default component Counter() { render (<div>Hello</div>) }', '/src/Counter.jsx');

		expect(result).toBeTruthy();
		expect(typeof result).toBe('object');
		expect((result as { code: string }).code).toContain('function Counter');
	});

	it('ignores plain JavaScript files without DarTsx syntax', async () => {
		const plugin = dartsx();
		await plugin.buildStart!.call(buildStartCtx(() => null, undefined));

		const result = await plugin.transform!.call({
			environment: { mode: 'build' },
		}, 'export const count = 1;', '/src/plain.js');

		expect(result).toBeUndefined();
	});

	it('invalidates stale reactive-call targets through the dev module graph', async () => {
		const plugin = dartsx();
		const formatId = '/src/format.ts';
		const invalidateModule = vi.fn();
		const moduleGraph = {
			getModuleById: (id: string) => (id === formatId ? { id } : undefined),
			invalidateModule,
		};

		await plugin.buildStart!.call(
			buildStartCtx(() => ({ id: formatId }), undefined),
		);

		const appSource = `import { formatCount } from './format'\n\nexport component App() {\nstate count = 0;\nrender (<p>{formatCount(count)}</p>)\n}`;

		const result = await plugin.transform!.call({
			environment: { mode: 'dev', moduleGraph },
		}, appSource, '/src/App.tsx');

		expect(result).toBeTruthy();
		// The plain helper became a reactive-call target — it must be
		// invalidated so vite re-transforms it with signal unwrapping.
		expect(invalidateModule).toHaveBeenCalledWith({ id: formatId });
	});
});