// The language worker's virtual file system. TS's default libs and the
// dartsx runtime's .d.ts files are fetched at worker boot as a path → text
// JSON map served by the languageTypesFs() plugin in vite.config.ts (dev
// middleware + build asset — same pattern as /playground-runtime.json).
// Type checking therefore works fully offline. Everything is mounted under
// file:///node_modules/** — the root @volar/typescript falls back to when
// resolving libs on the web — and project files resolve 'dartsx' by walking
// up from /tmp/project to /node_modules.
//
// React-host playground files (.react.tsx) get no types: they run against
// esm.sh at runtime and react types are out of scope for the repl.

export type FileType = 1 | 2; // 1 = file, 2 = directory (vscode-fileSystem-provider codes)

interface FsEntry {
	type: FileType;
	size: number;
	text?: string;
}

const files = new Map<string, FsEntry>();
const dirs = new Set<string>(['/node_modules', '/']);

function addFile(path: string, text: string): void {
	files.set(path, { type: 1, size: text.length, text });
	for (let dir = path; ;) {
		dir = dir.slice(0, dir.lastIndexOf('/'));
		if (!dir || dirs.has(dir)) break;
		dirs.add(dir);
	}
}

let loaded = false;

/** Fetch and mount the d.ts payload. Idempotent; resolves once mounted. */
export async function loadVirtualFs(): Promise<void> {
	if (loaded) return;
	const response = await fetch('/dartsx-lang-fs.json');
	if (!response.ok) throw new Error(`language FS payload unavailable (${response.status})`);
	const payload: Record<string, string> = await response.json();
	for (const [path, text] of Object.entries(payload)) {
		addFile(path, text);
	}
	loaded = true;
}

export const virtualFs = {
	stat(path: string): { type: FileType; ctime: number; mtime: number; size: number } | undefined {
		const file = files.get(path);
		if (file) return { type: 1, ctime: 0, mtime: 0, size: file.size };
		if (dirs.has(path)) return { type: 2, ctime: 0, mtime: 0, size: 0 };
		return undefined;
	},
	readFile(path: string): string | undefined {
		return files.get(path)?.text;
	},
	readDirectory(path: string): [string, FileType][] {
		const prefix = path === '/' ? '/' : path + '/';
		const names = new Set<string>();
		for (const file of files.keys()) {
			if (file.startsWith(prefix)) {
				const rest = file.slice(prefix.length);
				if (rest && !rest.includes('/')) names.add(rest);
			}
		}
		for (const dir of dirs) {
			if (dir.startsWith(prefix)) {
				const rest = dir.slice(prefix.length);
				if (rest && !rest.includes('/')) names.add(rest + '/');
			}
		}
		return [...names].map(name => (name.endsWith('/') ? [name.slice(0, -1), 2 as FileType] : [name, 1 as FileType]));
	},
};
