/**
 * Project tests — cross-file reactive tracking without a bundler.
 */
import { describe, expect, it } from 'vitest';
import { Project, type ProjectHooks } from '../../src/compiler/project';

/** In-memory module graph: full id → source. Resolves relative specifiers only. */
function makeHooks(files: Record<string, string>): ProjectHooks {
	return {
		async resolve(specifier: string) {
			if (!specifier.startsWith('./')) return null;
			const base = specifier.slice(2);
			for (const id of Object.keys(files)) {
				if (base === id || base === id.replace(/\.[^.]+$/, '')) return id;
				const name = id.split('/').pop()!;
				if (base === name || base === name.replace(/\.[^.]+$/, '')) return id;
			}
			return null;
		},
		readFile(id: string) {
			return files[id] ?? null;
		},
	};
}

const STORE = `/src/store.ts`;
const APP = `/src/App.tsx`;
const FORMAT = `/src/format.ts`;
const NUMBER_FORMAT = `/src/numberFormat.ts`;

describe('Project', () => {
	it('returns null for plain modules without DarTsx syntax', async () => {
		const project = new Project();
		const hooks = makeHooks({});
		const result = await project.update('/src/plain.ts', 'export const x = 1;', hooks);
		expect(result).toBeNull();
	});

	it('ignores DarTsx keywords inside comments and strings', async () => {
		const project = new Project();
		const hooks = makeHooks({});
		const result = await project.update(
			'/src/comment.ts',
			`// state x = 1\n/* derived y = 2 */\nconst s = "state z = 3";\nexport const plain = true;`,
			hooks,
		);
		expect(result).toBeNull();
	});

	it('compiles modules with DarTsx syntax even without imports', async () => {
		const project = new Project();
		const hooks = makeHooks({});
		const result = await project.update(
			APP,
			`export component App() {\nstate count = 0;\nrender (<p>{count}</p>)\n}`,
			hooks,
		);
		expect(result).not.toBeNull();
		expect(result!.code).toContain('$.state(0)');
	});

	it('propagates reactive exports to importing modules', async () => {
		const project = new Project();
		const files = {
			[STORE]: `export state count = 0;\n\nexport function increment() {\ncount += 1;\n}`,
			[APP]: `import { count, increment } from './store'\n\nexport component App() {\nrender (<button onclick={increment}>{count}</button>)\n}`,
		};
		const hooks = makeHooks(files);

		await project.update(STORE, files[STORE], hooks);
		const app = await project.update(APP, files[APP], hooks);

		expect(app).not.toBeNull();
		expect(app!.code).toContain('$.get(count)');
	});

	it('propagates reactive call info across plain helper modules and reports invalidations', async () => {
		const project = new Project();
		const files = {
			[APP]: `import { formatCount } from './format'\n\nexport component App() {\nstate count = 0;\nrender (<p>{formatCount(count)}</p>)\n}`,
			[FORMAT]: `import { numberFormat } from './numberFormat'\n\nexport function formatCount(count) {\nreturn \`Count: \${numberFormat(count)}\`\n}`,
			[NUMBER_FORMAT]: `export function numberFormat(value) {\nreturn value.toLocaleString()\n}`,
		};
		const hooks = makeHooks(files);

		// App compiles and invalidates its reactive-call target
		const app = await project.update(APP, files[APP], hooks);
		expect(app).not.toBeNull();
		expect(app!.invalidated).toContain(FORMAT);

		// The now-tracked helper compiles and forwards the chain
		const format = await project.update(FORMAT, files[FORMAT], hooks);
		expect(format).not.toBeNull();
		expect(format!.invalidated).toContain(NUMBER_FORMAT);

		// The leaf helper compiles with reactive param unwrapping
		const numberFormat = await project.update(NUMBER_FORMAT, files[NUMBER_FORMAT], hooks);
		expect(numberFormat).not.toBeNull();
		expect(numberFormat!.code).toContain('$.get(value)');

		// Convergence: recompiling App changes nothing
		const app2 = await project.update(APP, files[APP], hooks);
		expect(app2!.invalidated).toEqual([]);
	});

	it('recompiles targets that were compiled before their caller', async () => {
		const project = new Project();
		const files = {
			[APP]: `import { formatCount } from './format'\n\nexport component App() {\nstate count = 0;\nrender (<p>{formatCount(count)}</p>)\n}`,
			[FORMAT]: `import { numberFormat } from './numberFormat'\n\nexport function formatCount(count) {\nreturn \`Count: \${numberFormat(count)}\`\n}`,
			[NUMBER_FORMAT]: `export function numberFormat(value) {\nreturn value.toLocaleString()\n}`,
		};
		const hooks = makeHooks(files);

		// Targets are plain modules — no transform until a caller marks them
		expect(await project.update(FORMAT, files[FORMAT], hooks)).toBeNull();
		expect(await project.update(NUMBER_FORMAT, files[NUMBER_FORMAT], hooks)).toBeNull();

		// Caller compiles and invalidates the previously-skipped target
		const app = await project.update(APP, files[APP], hooks);
		expect(app!.invalidated).toEqual([FORMAT]);

		const format = await project.update(FORMAT, files[FORMAT], hooks);
		expect(format!.invalidated).toEqual([NUMBER_FORMAT]);

		const numberFormat = await project.update(NUMBER_FORMAT, files[NUMBER_FORMAT], hooks);
		expect(numberFormat!.code).toContain('$.get(value)');
	});

	it('skips reactive-call contributions into compiled dist output', async () => {
		const project = new Project();
		const DIST_HELPER = `/src/dist/helper.ts`;
		const files = {
			[APP]: `import { log } from './dist/helper'\n\nexport component App() {\nstate count = 0;\nrender (<p>{log(count)}</p>)\n}`,
			[DIST_HELPER]: `export function log(value) {\nconsole.log(value)\n}`,
		};
		const hooks = makeHooks(files);

		const app = await project.update(APP, files[APP], hooks);
		expect(app!.invalidated).not.toContain(DIST_HELPER);
		expect(await project.update(DIST_HELPER, files[DIST_HELPER], hooks)).toBeNull();
	});

	it('recompiles without reactive import info after a module is removed', async () => {
		const project = new Project();
		const files = {
			[STORE]: `export state count = 0;`,
			[APP]: `import { count } from './store'\n\nexport component App() {\nrender (<p>{count}</p>)\n}`,
		};
		const hooks = makeHooks(files);

		await project.update(STORE, files[STORE], hooks);
		const app = await project.update(APP, files[APP], hooks);
		expect(app!.code).toContain('$.get(count)');

		// Remove the store and stop serving its source (file deleted)
		project.remove(STORE);
		delete files[STORE];

		const app2 = await project.update(APP, files[APP], hooks);
		expect(app2).not.toBeNull();
		expect(app2!.code).not.toContain('$.get(count)');
	});
});