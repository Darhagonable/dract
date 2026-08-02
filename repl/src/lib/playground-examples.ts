// Curated playground examples. Every example is a folder under
// repl/examples/<NN-group>/<NN-example>/ — one real file per source, plus a
// meta.json with `{ "label", "entry" }` (entry defaults to the first file).
// Group folders carry their own meta.json label; their numeric prefixes order
// the dropdown, svelte.dev-style. The tree is loaded at build time with
// Vite's import.meta.glob, so examples are authored as plain files on disk,
// not template literals.
//
// Every example should compile warning-free through the real pipeline
// (playground-modules.ts) — keep new examples runnable and minimal: each
// demonstrates one API surface, not a whole app.
//
// File kinds are derived from the file name (see playground-modules.ts):
// `.tsx` compiles with the octane compiler; `.react.tsx` marks a React-HOST
// file (sucrase react-jsx transform) used by the OctaneCompat example,
// where real react-dom from esm.sh renders the entry.
import type { PlaygroundFile } from './playground-modules.ts';

export interface ExampleWorkspace {
	files: PlaygroundFile[];
	/** Module the sandbox imports and renders. Defaults to the first file. */
	entry: string;
}

export interface PlaygroundExample {
	id: string;
	label: string;
	/** Dropdown <optgroup> label. */
	group: string;
	workspace: ExampleWorkspace;
}

export const CUSTOM_EXAMPLE_ID = 'custom';

interface ExampleMeta {
	label?: string;
	entry?: string;
}

/** Every file under repl/examples/, keyed by path relative to this module. */
const rawFiles = import.meta.glob('../../examples/**/*', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

const EXAMPLES: PlaygroundExample[] = [];
const groupLabels = new Map<string, string>();
const filesByExample = new Map<string, { dir: string; files: PlaygroundFile[]; meta: ExampleMeta | null }>();

for (const [path, source] of Object.entries(rawFiles)) {
	const rel = path.replace('../../examples/', '');
	const [groupDir, ...rest] = rel.split('/');
	if (rest.length === 0 || !groupDir) continue;
	if (rest.length === 1) {
		if (rest[0] === 'meta.json') {
			try {
				groupLabels.set(groupDir, JSON.parse(source).label as string);
			} catch {
				// A malformed group meta.json is ignored; the folder name labels the group.
			}
		}
		continue;
	}
	const [exampleDir, ...fileParts] = rest;
	if (fileParts.length !== 1) continue;
	const key = `${groupDir}/${exampleDir}`;
	let bucket = filesByExample.get(key);
	if (!bucket) {
		bucket = { dir: exampleDir, files: [], meta: null };
		filesByExample.set(key, bucket);
	}
	if (fileParts[0] === 'meta.json') {
		try {
			bucket.meta = JSON.parse(source) as ExampleMeta;
		} catch {
			// Malformed example meta.json — fall back to folder-name labels.
		}
	} else {
		bucket.files.push({ name: fileParts[0], source });
	}
}

for (const [key, bucket] of filesByExample) {
	const [groupDir] = key.split('/');
	const meta = bucket.meta ?? {};
	const files = [...bucket.files].sort((a, b) => a.name.localeCompare(b.name));
	if (files.length === 0) continue;
	const label = meta.label ?? bucket.dir.replace(/^\d+-/, '').replace(/-/g, ' ');
	EXAMPLES.push({
		id: bucket.dir.replace(/^\d+-/, ''),
		label,
		group: groupLabels.get(groupDir) ?? groupDir.replace(/^\d+-/, '').replace(/-/g, ' '),
		workspace: {
			entry: meta.entry ?? files[0].name,
			files,
		},
	});
}

if (EXAMPLES.length === 0) {
	throw new Error('No playground examples found under repl/examples/ — check the example folder tree.');
}

/** All examples in dropdown order (group folders first, then example folders). */
export { EXAMPLES };

export function getExample(id: string): PlaygroundExample | undefined {
	return EXAMPLES.find((example) => example.id === id);
}

/** Deep-copy an example workspace into a mutable workspace. */
export function exampleWorkspace(example: PlaygroundExample): ExampleWorkspace {
	return {
		entry: example.workspace.entry,
		files: example.workspace.files.map((file) => ({ ...file })),
	};
}

/** The workspace the playground boots with (first example in the first group). */
export const DEFAULT_EXAMPLE_ID = EXAMPLES[0].id;
export const DEFAULT_WORKSPACE: ExampleWorkspace = exampleWorkspace(
	getExample(DEFAULT_EXAMPLE_ID)!,
);
