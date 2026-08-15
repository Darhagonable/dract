/**
 * Project tests — cross-file reactive tracking without a bundler.
 */
import { describe, expect, it } from 'vitest';
import { Project, type ProjectOptions } from '../../src/compiler/project';

/** In-memory module graph: full id → source. Resolves relative specifiers only. */
function makeProject(files: Record<string, string>, options: Partial<ProjectOptions> = {}): Project {
	return new Project({
		...options,
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
	});
}

const STORE = `/src/store.ts`;
const APP = `/src/App.tsx`;
const FORMAT = `/src/format.ts`;
const NUMBER_FORMAT = `/src/numberFormat.ts`;

const CHAIN_FILES = {
	[APP]: `import { formatCount } from './format'\n\nexport component App() {\nstate count = 0;\nrender (<p>{formatCount(count)}</p>)\n}`,
	[FORMAT]: `import { numberFormat } from './numberFormat'\n\nexport function formatCount(count) {\nreturn \`Count: \${numberFormat(count)}\`\n}`,
	[NUMBER_FORMAT]: `export function numberFormat(value) {\nreturn value.toLocaleString()\n}`,
};

describe('Project', () => {
	it('produces no output for plain modules without DarTsx syntax', async () => {
		const project = makeProject({});
		const { changed } = await project.update('/src/plain.ts', 'export const x = 1;');
		expect(changed).toEqual([]);
		expect(project.output('/src/plain.ts')).toBeNull();
	});

	it('ignores DarTsx keywords inside comments and strings', async () => {
		const project = makeProject({});
		const { changed } = await project.update(
			'/src/comment.ts',
			`// state x = 1\n/* derived y = 2 */\nconst s = "state z = 3";\nexport const plain = true;`,
		);
		expect(changed).toEqual([]);
		expect(project.output('/src/comment.ts')).toBeNull();
	});

	it('compiles modules with DarTsx syntax even without imports', async () => {
		const project = makeProject({});
		const { changed } = await project.update(
			APP,
			`export component App() {\nstate count = 0;\nrender (<p>{count}</p>)\n}`,
		);
		expect(changed).toEqual([APP]);
		expect(project.output(APP)!.code).toContain('$.state(0)');
	});

	it('propagates reactive exports to importing modules', async () => {
		const files = {
			[STORE]: `export state count = 0;\n\nexport function increment() {\ncount += 1;\n}`,
			[APP]: `import { count, increment } from './store'\n\nexport component App() {\nrender (<button onclick={increment}>{count}</button>)\n}`,
		};
		const project = makeProject(files);

		await project.update(STORE, files[STORE]);
		await project.update(APP, files[APP]);

		expect(project.output(APP)!.code).toContain('$.get(count)');
	});

	it('propagates reactive call info across plain helper modules and reports stale outputs', async () => {
		const project = makeProject(CHAIN_FILES);

		// App compiles and marks its reactive-call target stale
		const app = await project.update(APP, CHAIN_FILES[APP]);
		expect(app).toEqual({ changed: [APP, FORMAT] });
		expect(project.output(FORMAT)).toBeNull();

		// The now-tracked helper compiles and forwards the chain
		const format = await project.update(FORMAT, CHAIN_FILES[FORMAT]);
		expect(format).toEqual({ changed: [FORMAT, NUMBER_FORMAT] });
		expect(project.output(NUMBER_FORMAT)).toBeNull();

		// The leaf helper compiles with reactive param unwrapping
		const numberFormat = await project.update(NUMBER_FORMAT, CHAIN_FILES[NUMBER_FORMAT]);
		expect(numberFormat).toEqual({ changed: [NUMBER_FORMAT] });
		expect(project.output(NUMBER_FORMAT)!.code).toContain('$.get(value)');

		// Convergence: recompiling App changes nothing
		expect(await project.update(APP, CHAIN_FILES[APP])).toEqual({ changed: [APP] });
	});

	it('recompiles targets that were compiled before their caller', async () => {
		const project = makeProject(CHAIN_FILES);

		// Targets are plain modules — no output until a caller marks them
		expect(await project.update(FORMAT, CHAIN_FILES[FORMAT])).toEqual({ changed: [] });
		expect(await project.update(NUMBER_FORMAT, CHAIN_FILES[NUMBER_FORMAT])).toEqual({ changed: [] });

		// Caller compiles and marks the previously-skipped target stale
		const app = await project.update(APP, CHAIN_FILES[APP]);
		expect(app).toEqual({ changed: [APP, FORMAT] });

		const format = await project.update(FORMAT, CHAIN_FILES[FORMAT]);
		expect(format).toEqual({ changed: [FORMAT, NUMBER_FORMAT] });

		const numberFormat = await project.update(NUMBER_FORMAT, CHAIN_FILES[NUMBER_FORMAT]);
		expect(numberFormat).toEqual({ changed: [NUMBER_FORMAT] });
		expect(project.output(NUMBER_FORMAT)!.code).toContain('$.get(value)');
	});

	it('skips reactive-call contributions into compiled dist output', async () => {
		const DIST_HELPER = `/src/dist/helper.ts`;
		const files = {
			[APP]: `import { log } from './dist/helper'\n\nexport component App() {\nstate count = 0;\nrender (<p>{log(count)}</p>)\n}`,
			[DIST_HELPER]: `export function log(value) {\nconsole.log(value)\n}`,
		};
		const project = makeProject(files);

		const app = await project.update(APP, files[APP]);
		expect(app).toEqual({ changed: [APP] });
		expect(project.output(DIST_HELPER)).toBeNull();
	});

	it('drops stored output when a module stops qualifying', async () => {
		const project = makeProject({});
		const id = '/src/state.ts';
		await project.update(id, `export state count = 0;`);
		expect(project.output(id)).not.toBeNull();

		const { changed } = await project.update(id, `export const plain = true;`);
		expect(changed).toEqual([]);
		expect(project.output(id)).toBeNull();
	});

	it('recompiles without reactive import info after a module is removed', async () => {
		const files = {
			[STORE]: `export state count = 0;`,
			[APP]: `import { count } from './store'\n\nexport component App() {\nrender (<p>{count}</p>)\n}`,
		};
		const project = makeProject(files);

		await project.update(STORE, files[STORE]);
		await project.update(APP, files[APP]);
		expect(project.output(APP)!.code).toContain('$.get(count)');

		// Remove the store and stop serving its source (file deleted)
		project.remove(STORE);
		expect(project.output(STORE)).toBeNull();
		delete files[STORE];

		await project.update(APP, files[APP]);
		expect(project.output(APP)!.code).not.toContain('$.get(count)');
	});

	it('init() discovers and compiles the whole graph from an entry point', async () => {
		const project = makeProject(CHAIN_FILES, { entryPoints: [APP] });

		await project.init();

		expect(project.modules().sort()).toEqual([APP, FORMAT, NUMBER_FORMAT].sort());
		// The call chain resolves: the call forwards along the chain and the
		// leaf unwraps the signal at the definition where it's consumed.
		expect(project.output(APP)!.code).toContain('formatCount(count)');
		expect(project.output(FORMAT)!.code).toContain('numberFormat(count)');
		expect(project.output(NUMBER_FORMAT)!.code).toContain('$.get(value)');
	});

	it('init() converges the reactive-call chain in a single call', async () => {
		const project = makeProject(CHAIN_FILES, { entryPoints: [NUMBER_FORMAT, FORMAT, APP] });

		await project.init();

		// Every module ends up compiled with the full cross-file information,
		// regardless of the order init processed them in.
		expect(project.output(NUMBER_FORMAT)!.code).toContain('$.get(value)');
		expect(project.output(FORMAT)!.code).toContain('numberFormat(count)');
		expect(project.output(APP)!.code).toContain('formatCount(count)');
	});

	it('invalidates importers when a module changes its reactive exports', async () => {
		const files = {
			[STORE]: `export state count = 0;`,
			[APP]: `import { count, total } from './store'\n\nexport component App() {\nrender (<p>{count} {total}</p>)\n}`,
		};
		const project = makeProject(files);

		// App compiles against the store's current surface: count is reactive, total is not
		await project.update(STORE, files[STORE]);
		await project.update(APP, files[APP]);
		expect(project.output(APP)!.code).toContain('$.get(count)');
		expect(project.output(APP)!.code).not.toContain('$.get(total)');

		// The store gains a reactive export — its importers must recompile
		const { changed } = await project.update(STORE, `export state count = 0;\nexport state total = 0;`);
		expect(changed).toEqual(expect.arrayContaining([STORE, APP]));

		// After recompiling, the new export is reactive in the importer
		await project.update(APP, files[APP]);
		expect(project.output(APP)!.code).toContain('$.get(total)');
	});

	it('modules() reflects updates and removals', async () => {
		const project = makeProject(CHAIN_FILES);

		await project.update(APP, CHAIN_FILES[APP]);
		await project.update(FORMAT, CHAIN_FILES[FORMAT]);
		// NumberFormat is known because FORMAT resolved it as an import
		expect(project.modules().sort()).toEqual([APP, FORMAT, NUMBER_FORMAT].sort());

		project.remove(FORMAT);
		expect(project.modules().sort()).toEqual([APP, NUMBER_FORMAT].sort());
		expect(project.output(FORMAT)).toBeNull();
	});
});