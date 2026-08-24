// The Workspace is the kernel's domain object: it IS the user's project —
// the virtual file set plus its entry — and every file mutation flows through
// its methods so invariants (entry/tsconfig protection, name deconfliction,
// size budgets) hold in exactly one place. It knows nothing about React,
// CodeMirror, compilation, or the preview; higher layers observe changes and
// decide what to re-run.
//
// This mirrors Svelte REPL's Workspace / solid-repl's kernel.workspace: the
// UI becomes a client of the project model rather than the owner of loose
// arrays.
import {
	TSCONFIG_FILE_NAME,
	isTsconfigFile,
	type PlaygroundFile,
} from './types.ts';
import { MAX_PLAYGROUND_FILES } from './serialization.ts';

/** A plain serializable workspace snapshot ({files, entry}). */
export interface WorkspaceData {
	files: PlaygroundFile[];
	entry: string;
}

export type WorkspaceListener = () => void;

/** Deep-copy a workspace snapshot (example payloads, boot defaults). */
export function cloneWorkspaceData(workspace: WorkspaceData): WorkspaceData {
	return {
		entry: workspace.entry,
		files: workspace.files.map((file) => ({ ...file })),
	};
}

/**
 * Svelte-REPL-style name deconfliction: keep the base name, suffix a counter
 * before the first extension (or at the end).
 */
export function deconflictFileName(names: Set<string>, desired: string): string {
	let name = desired;
	let counter = 1;
	while (names.has(name)) {
		name = desired.replace(/(\.|$)/, `${counter++}$1`);
	}
	return name;
}

/** Generate the next free "File.tsx" / "File-2.tsx" / … name. */
export function nextFreeFileName(names: Set<string>): string {
	let index = 1;
	let name = 'File.tsx';
	while (names.has(name)) name = `File-${++index}.tsx`;
	return name;
}

/** A new file starts as a comment valid for any file kind. */
export const NEW_FILE_SOURCE = '// New file — replace this with your code.';

export class Workspace {
	private data: WorkspaceData;
	private listeners = new Set<WorkspaceListener>();

	constructor(data?: WorkspaceData) {
		this.data = data ? cloneWorkspaceData(data) : { files: [], entry: '' };
	}

	subscribe(listener: WorkspaceListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		for (const listener of [...this.listeners]) listener();
	}

	/** The live file list — treat as read-only; mutate through methods. */
	get files(): readonly PlaygroundFile[] {
		return this.data.files;
	}

	get entry(): string {
		return this.data.entry;
	}

	names(): Set<string> {
		return new Set(this.data.files.map((file) => file.name));
	}

	has(name: string): boolean {
		return this.data.files.some((file) => file.name === name);
	}

	get(name: string): PlaygroundFile | undefined {
		return this.data.files.find((file) => file.name === name);
	}

	source(name: string): string {
		return this.get(name)?.source ?? '';
	}

	/** Total authored characters across ALL files (the share-hash budget). */
	totalLength(): number {
		return this.data.files.reduce((sum, file) => sum + file.source.length, 0);
	}

	/** Update one file's source. Returns false when the file doesn't exist. */
	update(name: string, source: string): boolean {
		const file = this.get(name);
		if (!file || file.source === source) return false;
		file.source = source;
		this.changed();
		return true;
	}

	/**
	 * Add a file. Returns null when the workspace is full or the name is
	 * taken; otherwise the new file.
	 */
	add(name: string, source: string = NEW_FILE_SOURCE): PlaygroundFile | null {
		if (this.data.files.length >= MAX_PLAYGROUND_FILES) return null;
		if (this.has(name)) return null;
		const file: PlaygroundFile = { name, source };
		this.data.files.push(file);
		this.changed();
		return file;
	}

	/**
	 * Remove a file by index position in the tab strip. The entry is the
	 * workspace root and the tsconfig is injected state — neither can be
	 * deleted. Returns the removed index, or -1 when removal is not allowed.
	 */
	remove(name: string): number {
		if (this.data.files.length <= 1) return -1;
		if (name === this.data.entry || isTsconfigFile(name)) return -1;
		const index = this.data.files.findIndex((file) => file.name === name);
		if (index < 0) return -1;
		this.data.files.splice(index, 1);
		this.changed();
		return index;
	}

	/**
	 * Rename a file. The entry and tsconfig names are fixed. Returns the
	 * final (deconflicted) name, or null when renaming is not allowed.
	 */
	rename(oldName: string, desiredName: string): string | null {
		if (!oldName || !desiredName) return null;
		const file = this.get(oldName);
		if (!file || file.name === this.data.entry || isTsconfigFile(file.name)) return null;
		const trimmed = desiredName.trim();
		if (!trimmed || trimmed === oldName) return null;
		const name = deconflictFileName(this.names(), trimmed);
		file.name = name;
		this.changed();
		return name;
	}

	/**
	 * Drag-reorder: the dropped file takes the slot of the file it was
	 * dropped on (Svelte-REPL semantics). Returns false on unknown names.
	 */
	move(fromName: string, toName: string): boolean {
		if (fromName === toName) return false;
		const fromIndex = this.data.files.findIndex((file) => file.name === fromName);
		const toIndex = this.data.files.findIndex((file) => file.name === toName);
		if (fromIndex < 0 || toIndex < 0) return false;
		const [file] = this.data.files.splice(fromIndex, 1);
		this.data.files.splice(toIndex, 0, file);
		this.changed();
		return true;
	}

	/**
	 * Vue-REPL-style tsconfig invariant: a workspace always carries its
	 * config file, even when a hash payload or example did not include one.
	 */
	ensureTsconfig(source: string): void {
		if (this.has(TSCONFIG_FILE_NAME)) return;
		this.data.files.push({ name: TSCONFIG_FILE_NAME, source });
	}

	/**
	 * Replace the whole contents (example switch / hash restore). When
	 * `preserveTsconfig` is set, the visitor's current tsconfig survives —
	 * it is workspace state, not example content.
	 */
	load(data: WorkspaceData, options: { preserveTsconfig?: boolean } = {}): void {
		const tsconfig =
			options.preserveTsconfig && !data.files.some((file) => file.name === TSCONFIG_FILE_NAME)
				? this.get(TSCONFIG_FILE_NAME)
				: undefined;
		this.data = cloneWorkspaceData(data);
		if (tsconfig) this.data.files.push({ ...tsconfig });
		this.changed();
	}

	snapshot(): WorkspaceData {
		return cloneWorkspaceData(this.data);
	}
}
