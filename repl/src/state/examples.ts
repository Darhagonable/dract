// Examples: the files under repl/examples/ (shared with the site through
// meta.json metadata), loaded as raw text. Every workspace gets the shared
// examples tsconfig.json as an editable virtual file.

import type { PlaygroundFile } from '../editor/models';
import { TSCONFIG_FILE } from '../editor/models';
import meta from '../../examples/meta.json';
import tsconfigSource from '../../examples/tsconfig.json?raw';

const modules = import.meta.glob('../../examples/**/*.{tsx,ts}', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

const ENTRY_FILE = 'App.tsx';

interface ExampleMeta {
	path: string;
	label: string;
}

interface ExampleGroup {
	label: string;
	examples: ExampleMeta[];
}

const groups = meta.groups as ExampleGroup[];

/** Flat example list (labels are unique). */
export const EXAMPLES: ExampleMeta[] = groups.flatMap((group) => group.examples);

export const DEFAULT_EXAMPLE_PATH = '/store';

/** Load an example's files: entry first, then its other modules, then tsconfig. */
export function loadExample(path: string): PlaygroundFile[] {
	const prefix = `../../examples${path}/`;
	const names = Object.keys(modules)
		.filter((key) => key.startsWith(prefix))
		.map((key) => key.slice(prefix.length));
	names.sort((a, b) => (a === ENTRY_FILE ? -1 : b === ENTRY_FILE ? 1 : a.localeCompare(b)));
	const files: PlaygroundFile[] = names.map((name) => ({ name, source: modules[`${prefix}${name}`] }));
	files.push({ name: TSCONFIG_FILE, source: tsconfigSource });
	return files;
}
