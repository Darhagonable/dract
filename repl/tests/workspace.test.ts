// Kernel guardrails: the Workspace's file-model invariants. These are the
// rules most likely to break silently while responsibilities move between
// kernel, engine, and UI — they must hold without React, the engine, or the
// compiler.
import { describe, expect, it } from 'vitest';
import {
	Workspace,
	deconflictFileName,
	nextFreeFileName,
} from '../src/kernel/workspace.ts';
import { TSCONFIG_FILE_NAME, type PlaygroundFile } from '../src/kernel/types.ts';
import { MAX_PLAYGROUND_FILES } from '../src/kernel/serialization.ts';

const TSCONFIG_SOURCE = '{"compilerOptions":{}}';

function makeWorkspace(): Workspace {
	const workspace = new Workspace({
		entry: 'App.tsx',
		files: [
			{ name: 'App.tsx', source: 'export default function App() {}' },
			{ name: 'store.ts', source: 'export const x = 1;' },
			{ name: TSCONFIG_FILE_NAME, source: TSCONFIG_SOURCE },
		],
	});
	return workspace;
}

describe('Workspace invariants', () => {
	it('starts as a deep copy of the seed data', () => {
		const files: PlaygroundFile[] = [{ name: 'App.tsx', source: 'a' }];
		const workspace = new Workspace({ entry: 'App.tsx', files });
		files[0]!.source = 'mutated';
		expect(workspace.source('App.tsx')).toBe('a');
	});

	it('updates an existing file and reports no-ops', () => {
		const workspace = makeWorkspace();
		expect(workspace.update('App.tsx', 'next')).toBe(true);
		expect(workspace.source('App.tsx')).toBe('next');
		expect(workspace.update('missing.tsx', 'x')).toBe(false);
		expect(workspace.update('App.tsx', 'next')).toBe(false);
	});

	it('never deletes the last remaining file', () => {
		const workspace = new Workspace({
			entry: 'App.tsx',
			files: [{ name: 'App.tsx', source: 'a' }],
		});
		expect(workspace.remove('App.tsx')).toBe(-1);
		expect(workspace.files).toHaveLength(1);
	});

	it('protects the entry and the tsconfig from deletion', () => {
		const workspace = makeWorkspace();
		expect(workspace.remove('App.tsx')).toBe(-1);
		expect(workspace.remove(TSCONFIG_FILE_NAME)).toBe(-1);
		// Ordinary files go.
		expect(workspace.remove('store.ts')).toBe(1);
		expect(workspace.has('store.ts')).toBe(false);
	});

	it('remove returns the tab-strip index so callers can fall to the neighbor', () => {
		const workspace = new Workspace({
			entry: 'App.tsx',
			files: [
				{ name: 'App.tsx', source: '' },
				{ name: 'A.tsx', source: '' },
				{ name: 'B.tsx', source: '' },
				{ name: TSCONFIG_FILE_NAME, source: TSCONFIG_SOURCE },
			],
		});
		expect(workspace.remove('A.tsx')).toBe(1);
		// B took A's slot; removing B now falls back within bounds.
		expect(workspace.remove('B.tsx')).toBe(1);
		expect(workspace.files.map((f) => f.name)).toEqual(['App.tsx', TSCONFIG_FILE_NAME]);
	});

	it('add enforces the file-count budget and unique names', () => {
		const workspace = makeWorkspace();
		expect(workspace.add('store.ts')).toBeNull();
		const added = workspace.add('New.tsx', 'hi');
		expect(added?.name).toBe('New.tsx');
		// Fill up to MAX_PLAYGROUND_FILES, then refuse.
		while (workspace.files.length < MAX_PLAYGROUND_FILES) workspace.add(`F${workspace.files.length}.tsx`);
		expect(workspace.files.length).toBe(MAX_PLAYGROUND_FILES);
		expect(workspace.add('One-more.tsx')).toBeNull();
	});

	it('rename protects fixed names, trims, and deconflicts', () => {
		const workspace = makeWorkspace();
		expect(workspace.rename('App.tsx', 'Renamed.tsx')).toBeNull(); // entry is fixed
		expect(workspace.rename(TSCONFIG_FILE_NAME, 'x.json')).toBeNull(); // tsconfig is fixed
		expect(workspace.rename('missing.tsx', 'x.tsx')).toBeNull();
		expect(workspace.rename('store.ts', '   ')).toBeNull();
		expect(workspace.rename('store.ts', 'store.ts')).toBeNull();

		expect(workspace.rename('store.ts', ' App.tsx ')).toBe('App1.tsx');
		expect(workspace.get('App1.tsx')?.source).toBe('export const x = 1;');
		expect(workspace.has('store.ts')).toBe(false);
	});

	it('move reorders tabs (dropped file takes the target slot)', () => {
		const workspace = makeWorkspace();
		expect(workspace.move('App.tsx', TSCONFIG_FILE_NAME)).toBe(true);
		expect(workspace.files[0]?.name).toBe('store.ts');
		expect(workspace.files[1]?.name).toBe(TSCONFIG_FILE_NAME);
		expect(workspace.files[2]?.name).toBe('App.tsx');
		expect(workspace.move('nope.tsx', 'App.tsx')).toBe(false);
	});

	it('ensureTsconfig injects exactly once', () => {
		const workspace = new Workspace({
			entry: 'App.tsx',
			files: [{ name: 'App.tsx', source: '' }],
		});
		workspace.ensureTsconfig(TSCONFIG_SOURCE);
		workspace.ensureTsconfig('other');
		expect(workspace.files.filter((f) => f.name === TSCONFIG_FILE_NAME)).toHaveLength(1);
	});

	it('load replaces contents; preserveTsconfig keeps the visitor config', () => {
		const workspace = makeWorkspace();
		workspace.load(
			{
				entry: 'Other.tsx',
				files: [{ name: 'Other.tsx', source: 'b' }],
			},
			{ preserveTsconfig: true },
		);
		expect(workspace.entry).toBe('Other.tsx');
		expect(workspace.names()).toEqual(new Set(['Other.tsx', TSCONFIG_FILE_NAME]));
		expect(workspace.source(TSCONFIG_FILE_NAME)).toBe(TSCONFIG_SOURCE);

		// Without preservation, the payload stands alone.
		workspace.load({ entry: 'Third.tsx', files: [{ name: 'Third.tsx', source: 'c' }] });
		expect(workspace.names()).toEqual(new Set(['Third.tsx']));
	});

	it('notifies subscribers on mutations only', () => {
		const workspace = makeWorkspace();
		let changes = 0;
		const unsubscribe = workspace.subscribe(() => changes++);
		workspace.update('App.tsx', 'next');
		workspace.update('App.tsx', 'next');
		expect(changes).toBe(1); // identical source → no-op
		workspace.add('X.tsx');
		unsubscribe();
		workspace.remove('X.tsx');
		expect(changes).toBe(2);
	});
});

describe('file-name helpers', () => {
	it('generates File.tsx then File-2.tsx, …', () => {
		expect(nextFreeFileName(new Set())).toBe('File.tsx');
		expect(nextFreeFileName(new Set(['File.tsx']))).toBe('File-2.tsx');
		expect(nextFreeFileName(new Set(['File.tsx', 'File-2.tsx']))).toBe('File-3.tsx');
	});

	it('deconflicts before the extension, or at the end', () => {
		expect(deconflictFileName(new Set(['App.tsx']), 'App.tsx')).toBe('App1.tsx');
		expect(deconflictFileName(new Set(['App.tsx', 'App1.tsx']), 'App.tsx')).toBe('App2.tsx');
		expect(deconflictFileName(new Set(['README']), 'README')).toBe('README1');
	});
});
