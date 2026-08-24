// Curated playground examples, loaded at build time with Vite's
// import.meta.glob
//
// entry defaults to "App.tsx". Example ids are folder names. Every folder on
// disk must be listed in meta.json (and vice versa) — mismatches throw at load
// time so authoring mistakes surface immediately.
import type { PlaygroundFile } from './playground-modules.ts';

export interface ExampleWorkspace {
	files: PlaygroundFile[];
	/** Module the sandbox imports and renders. Defaults to "App.tsx". */
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
export const TSCONFIG_FILE_NAME = 'tsconfig.json';
export const DEFAULT_ENTRY_FILE = 'App.tsx';

interface MetaFile {
	groups?: {
		label?: string;
		examples?: { path?: string; label?: string; entry?: string }[];
	}[];
}

/** Every file under repl/examples/, keyed by path relative to this module. */
const rawFiles = import.meta.glob('../../examples/**/*', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

function throwError(message: string): never {
	throw new Error(message);
}

/** Shared tsconfig seed - copied into every workspace as an editable tab. */
export const SHARED_TSCONFIG_SOURCE =
	rawFiles['../../examples/tsconfig.json'] ??
	throwError('examples/tsconfig.json is missing - it seeds every workspace.');
void SHARED_TSCONFIG_SOURCE;

/** Sources grouped by directory path relative to repl/examples/. */
const sourcesByPath = new Map<string, PlaygroundFile[]>();
const onDisk = new Set<string>();

for (const [path, source] of Object.entries(rawFiles)) {
	const rel = path.replace('../../examples/', '');
	const slash = rel.indexOf('/');
	if (slash === -1) continue; // root-level meta.json / tsconfig.json / stray files
	const dir = '/' + rel.slice(0, slash);
	const name = rel.slice(slash + 1);
	onDisk.add(dir);
	if (!sourcesByPath.has(dir)) sourcesByPath.set(dir, []);
	sourcesByPath.get(dir)!.push({ name, source });
}

let meta: MetaFile;
try {
	meta = JSON.parse(rawFiles['../../examples/meta.json'] ?? '') as MetaFile;
} catch {
	throwError('examples/meta.json is missing or malformed.');
}

function buildExamples(metaFile: MetaFile): PlaygroundExample[] {
	const examples: PlaygroundExample[] = [];
	for (const group of metaFile.groups ?? []) {
		const groupLabel = group.label ?? 'Examples';
		for (const spec of group.examples ?? []) {
			if (!spec.path) {
				throwError(`examples/meta.json has an example without a path in group "${groupLabel}".`);
			}
			const id = spec.path;
			const files = sourcesByPath.get(id);
			if (!files || files.length === 0) {
				throwError(
					`examples/meta.json lists "${id}", but no such folder exists under repl/examples/.`,
				);
			}
			examples.push({
				id,
				label: spec.label ?? id,
				group: groupLabel,
				workspace: {
					files: [...files].sort((a, b) => a.name.localeCompare(b.name)),
					entry: spec.entry ?? DEFAULT_ENTRY_FILE,
				},
			});
		}
	}
	return examples;
}

const EXAMPLES = buildExamples(meta);

for (const id of onDisk) {
	if (!EXAMPLES.some((example) => example.id === id)) {
		throwError(`Folder repl/examples/${id}/ is not listed in examples/meta.json.`);
	}
}

if (EXAMPLES.length === 0) {
	throwError('No playground examples found under repl/examples/ - check meta.json.');
}

/** All examples in dropdown order. */
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

/** The workspace the playground boots with (first example of the first group). */
export const DEFAULT_EXAMPLE_ID = EXAMPLES[0]!.id;
export const DEFAULT_WORKSPACE: ExampleWorkspace = exampleWorkspace(getExample(DEFAULT_EXAMPLE_ID)!);
