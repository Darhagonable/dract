// Keeps the TypeScript language session in lockstep with the workspace:
// document open/change/close bookkeeping (mirrors solid-repl's tab sync —
// the worker dedupes identical texts, so liberal syncing is cheap), type
// acquisition for esm.sh externals, and the visitor-editable tsconfig that
// drives the service's compiler options. Everything no-ops when the session
// failed to spawn — the playground stays fully usable without it.
import { StateEffect, type Extension, type Transaction } from '@codemirror/state';
import { linter, lintGutter } from '@codemirror/lint';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { parsePlaygroundTsconfig } from '../../kernel/bundler.ts';
import { isTsconfigFile, type PlaygroundFile } from '../../kernel/types.ts';
import type { TypescriptSession } from './typescript-session.ts';

/** The playground URI scheme the worker resolves files under. */
export const uriFor = (name: string): string => `file:///playground/${name}`;

/**
 * Re-run pending lints when types/config change underneath — the lint inputs
 * changed without any document edit. The linter's `needsRefresh` listens for
 * exactly this effect.
 */
export const relint = StateEffect.define<null>();

export interface TsDocumentSyncDeps {
	/** The live workspace file set. */
	getFiles(): readonly PlaygroundFile[];
	/** The file whose diagnostics the source editor currently shows. */
	getActiveFile(): string;
	/** The editor views to re-lint when types/config change underneath. */
	getViews(): EditorView[];
	isDisposed(): boolean;
}

export class TsDocumentSync {
	private readonly registeredTsSources = new Map<string, string>();
	private lastExternals = '';
	private lastTsconfig = '';
	private tsconfigSyncTimer = 0;

	constructor(
		private readonly session: TypescriptSession | null,
		private readonly deps: TsDocumentSyncDeps,
	) {}

	/** The linter extension for source editors, or [] without a session. */
	lintExtension(): Extension[] {
		if (!this.session) return [];
		return [
			linter(
				(view) => {
					const activeFile = this.deps.getActiveFile();
					if (!this.session || isTsconfigFile(activeFile)) return [];
					return this.session.getDiagnostics(uriFor(activeFile), view);
				},
				{
					delay: 400,
					needsRefresh: (update: ViewUpdate) =>
						update.transactions.some((tr: Transaction) =>
							tr.effects.some((e) => e.is(relint)),
						),
				},
			),
			lintGutter(),
		];
	}

	forceRelint(): void {
		if (!this.session) return;
		for (const target of this.deps.getViews()) {
			target?.dispatch({ effects: relint.of(null) });
		}
	}

	syncFiles(): void {
		const session = this.session;
		if (!session || this.deps.isDisposed()) return;
		const files = this.deps.getFiles();
		const liveNames = new Set(files.map((file) => file.name));
		for (const name of [...this.registeredTsSources.keys()]) {
			if (!liveNames.has(name)) {
				session.worker.postMessage({
					method: 'textDocument/didClose',
					params: { textDocument: { uri: uriFor(name) } },
				});
				this.registeredTsSources.delete(name);
			}
		}
		for (const file of files) {
			if (isTsconfigFile(file.name)) continue;
			if (this.registeredTsSources.get(file.name) === file.source) continue;
			const isOpen = this.registeredTsSources.has(file.name);
			this.registeredTsSources.set(file.name, file.source);
			session.worker.postMessage(
				isOpen
					? {
						method: 'textDocument/didChange',
						params: {
							textDocument: { uri: uriFor(file.name), version: 0 },
							contentChanges: [{ text: file.source }],
						},
					}
					: {
						method: 'textDocument/didOpen',
						params: {
							textDocument: { uri: uriFor(file.name), languageId: 'typescript', version: 0, text: file.source },
						},
					},
			);
		}
	}

	/**
	 * Type acquisition input: the externals map from the last successful
	 * graph build, synced only when it actually changes.
	 */
	syncTypesFor(graph: { externals?: Record<string, string> } | null): void {
		const session = this.session;
		if (!session || !graph?.externals) return;
		const fingerprint = JSON.stringify(graph.externals);
		if (fingerprint === this.lastExternals) return;
		this.lastExternals = fingerprint;
		void session.syncTypes(graph.externals).then((changed: boolean) => {
			if (changed && !this.deps.isDisposed()) this.forceRelint();
		}).catch(() => { });
	}

	/** Debounced: the visitor-editable tsconfig drives the compiler options. */
	scheduleTsconfigSync(): void {
		if (!this.session) return;
		window.clearTimeout(this.tsconfigSyncTimer);
		this.tsconfigSyncTimer = window.setTimeout(() => {
			const session = this.session;
			if (this.deps.isDisposed() || !session) return;
			const config = parsePlaygroundTsconfig(this.deps.getFiles());
			const fingerprint = JSON.stringify(config);
			if (fingerprint === this.lastTsconfig) return;
			this.lastTsconfig = fingerprint;
			void session.syncTsconfig(config).then(() => {
				if (!this.deps.isDisposed()) this.forceRelint();
			}).catch(() => { });
		}, 300);
	}

	dispose(): void {
		window.clearTimeout(this.tsconfigSyncTimer);
	}
}
