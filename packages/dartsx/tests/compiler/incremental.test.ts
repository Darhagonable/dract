import { it, expect } from 'vitest';
import { ProjectCompiler } from '../../src/compiler/index';

const STORE = `export state count = 0;
`;
const APP = `import { count } from './store';
export default component App() {
	render (<button>clicks: {count}</button>);
}
`;
const UTILS = `export function watchCount(count: number) {
	count += 1;
}
`;

function compileAll(project: ProjectCompiler) {
	project.addFile('/store.ts', STORE);
	project.addFile('/app.tsx', APP);
	project.addFile('/utils.ts', UTILS);
	return project.compileAll();
}

it('incremental: unchanged source is a no-op', () => {
	const project = new ProjectCompiler();
	compileAll(project);
	expect(project.updateFile('/store.ts', STORE).changed).toEqual([]);
	expect(project.updateFile('/app.tsx', APP).changed).toEqual([]);
});

it('incremental: body edit recompiles only that file', () => {
	const project = new ProjectCompiler();
	compileAll(project);
	expect(project.updateFile('/app.tsx', APP + '\n').changed).toEqual(['/app.tsx']);
});

it('incremental: a changed reactive export recompiles importers', () => {
	const project = new ProjectCompiler();
	compileAll(project);
	const nextStore = STORE + 'export derived doubled = count * 2;\n';
	const update = project.updateFile('/store.ts', nextStore);
	expect(update.changed.sort()).toEqual(['/app.tsx', '/store.ts']);
});

it('incremental: an unchanged reactive export set spares importers', () => {
	const project = new ProjectCompiler();
	compileAll(project);
	const nextStore = STORE + '// only a comment\n';
	expect(project.updateFile('/store.ts', nextStore).changed).toEqual(['/store.ts']);
});

it('incremental: a contribution change recompiles the target', () => {
	const project = new ProjectCompiler();
	compileAll(project);
	const caller = `import { count } from './store';
import { watchCount } from './utils';
watchCount(count);
`;
	project.addFile('/main.ts', caller);
	expect(project.updateFile('/main.ts', caller).changed.sort()).toEqual(['/main.ts', '/utils.ts']);
	// The target now treats its param as reactive — contribution persisted.
	const utilsOutput = project.output('/utils.ts');
	expect(utilsOutput?.code).toContain('$.set(count, $.get(count) + 1)');
});

it('incremental: generated output matches compileAll output for the same graph', () => {
	const project = new ProjectCompiler();
	const outputs = compileAll(project);
	const byId = new Map(project.output('/store.ts') ? [['/store.ts', project.output('/store.ts')]] : []);
	for (const [id, output] of outputs) byId.set(id, output);
	// Rebuild from scratch via updates must converge to identical output.
	const project2 = new ProjectCompiler();
	project2.updateFile('/store.ts', STORE);
	project2.updateFile('/app.tsx', APP);
	project2.updateFile('/utils.ts', UTILS);
	for (const [id, output] of byId) {
		expect(project2.output(id)?.code, id).toBe(output.code);
	}
});

it('incremental: removeFile recompiles importers of reactive exports', () => {
	const project = new ProjectCompiler();
	compileAll(project);
	const main = `import { count } from './store';
import { watchCount } from './utils';
watchCount(count);
`;
	project.updateFile('/main.ts', main);
	expect(project.removeFile('/store.ts').changed.sort()).toEqual(['/app.tsx', '/main.ts', '/utils.ts']);
	// `count` is no longer a signal, so the contribution toward watchCount
	// disappears and utils loses its reactive param.
	expect(project.output('/utils.ts')?.code).not.toContain('$.set(count');
});
