// One-off migration script: writes every example from the inline template
// strings of src/lib/playground-examples.ts into a svelte.dev-style folder
// tree under repl/examples/<NN-group>/<NN-example>/.
// Run: pnpm exec sucrase-node scripts/extract-examples.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { EXAMPLES } from '../src/lib/playground-examples.ts';

const GROUP_DIR: Record<string, string> = {
	Basics: '00-basics',
	'State & context': '01-state-and-context',
	'Async & Suspense': '02-async-and-suspense',
	'Transitions & animation': '03-transitions-and-animation',
	Forms: '04-forms',
	Ecosystem: '05-ecosystem',
};

const GROUP_ORDER = Object.keys(GROUP_DIR);
const EXAMPLE_ORDER: Record<string, string[]> = {
	Basics: ['counter', 'keyed-list', 'inputs'],
	'State & context': ['branch-hooks', 'context', 'portals', 'dynamic-tags'],
	'Async & Suspense': ['suspense', 'parallel-use'],
	'Transitions & animation': ['transitions', 'view-transition'],
	Forms: ['form-actions'],
	Ecosystem: ['esm-sh', 'octane-compat'],
};

const root = new URL('../examples/', import.meta.url);

for (const example of EXAMPLES) {
	const groupDir = GROUP_DIR[example.group];
	const order = EXAMPLE_ORDER[example.group];
	const index = order.indexOf(example.id);
	if (!groupDir || index < 0) throw new Error(`no folder mapping for ${example.id}`);
	const dir = new URL(`${groupDir}/${String(index).padStart(2, '0')}-${example.id}/`, root);
	mkdirSync(dir, { recursive: true });
	for (const file of example.workspace.files) {
		writeFileSync(new URL(file.name, dir), file.source);
	}
	writeFileSync(
		new URL('meta.json', dir),
		JSON.stringify({ label: example.label, entry: example.workspace.entry }, null, '\t') + '\n',
	);
}

for (const group of GROUP_ORDER) {
	const dir = new URL(`${GROUP_DIR[group]}/`, root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(new URL('meta.json', dir), JSON.stringify({ label: group }, null, '\t') + '\n');
}

console.log('wrote', EXAMPLES.length, 'examples to', root.pathname);
