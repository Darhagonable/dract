// Main-thread half of the DarTsx language worker (see dartsx.worker.ts for
// the architecture overview). This is the vue-repl wiring from
// @volar/monaco — activateMarkers + registerProviders + activateAutoInsertion
// — driven through a ~70-line MonacoWebWorker shim: the codingame monaco
// fork removed monaco's createWebWorker API, so the worker is ours and
// withSyncedResources maps to the protocol's full-text sync.

import * as monaco from 'monaco-editor';
import { activateAutoInsertion, activateMarkers, registerProviders } from '@volar/monaco';
import type { WorkerLanguageService } from '@volar/monaco/worker';
import { toMarkerData } from 'monaco-languageserver-types';
import type { SyncModel, WorkerInbound, WorkerOutbound } from './protocol';

const MARKERS_OWNER = 'dartsx-ts';
const LANGUAGE_IDS = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
const SELECTOR: monaco.languages.LanguageSelector = LANGUAGE_IDS.map(language => ({ language }));

// monaco-types (volar's monaco-editor-core typings) and the codingame fork's
// declarations are structurally identical but nominally distinct — same
// bridge as the vsixPlugin cast in vite.config.ts.
type VolarEditor = Parameters<typeof activateMarkers>[4];
type VolarLanguages = Parameters<typeof registerProviders>[3];
type VolarWorker = Parameters<typeof activateMarkers>[0];

export interface DartsxLanguageService {
	dispose(): void;
}

export function createDartsxLanguageService(
	getSyncUris: () => monaco.Uri[],
	getCompilerOptions: () => Record<string, unknown> | null,
): DartsxLanguageService {
	const worker = new Worker(new URL('./dartsx.worker.ts', import.meta.url), { type: 'module' });
	const sinks = new Map<number, { resolve: (result?: unknown) => void; reject: (error: Error) => void }>();
	let nextId = 1;
	let disposed = false;
	let syncChain: Promise<void> = Promise.resolve();

	worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
		const message = event.data;
		if (message.type === 'synced') {
			syncResolve?.();
			syncResolve = null;
			return;
		}
		if (message.type === 'response') {
			const sink = sinks.get(message.id);
			if (sink) {
				sinks.delete(message.id);
				if (message.error !== undefined) sink.reject(new Error(message.error));
				else sink.resolve(message.result);
			}
		}
	};

	let syncResolve: (() => void) | null = null;

	function post(message: WorkerInbound): void {
		if (!disposed) worker.postMessage(message);
	}

	function request(method: string, args: unknown[]): Promise<unknown> {
		const id = nextId++;
		return new Promise((resolve, reject) => {
			sinks.set(id, { resolve, reject });
			post({ type: 'request', id, method, args });
		});
	}

	post({ type: 'init', compilerOptions: getCompilerOptions() });

	// RPC proxy standing in for the WorkerLanguageService the worker holds.
	// `then` MUST stay undefined: a callable then makes the proxy thenable,
	// and every promise assimilation (Promise.resolve, awaiting a chain that
	// resolves to it) would hijack it into a bogus RPC round-trip.
	const proxy = new Proxy({} as WorkerLanguageService, {
		get(_target, prop) {
			if (typeof prop !== 'string' || prop === 'then') return undefined;
			return (...args: unknown[]) => request(prop, args);
		},
	});

	// The MonacoWebWorker-shaped object @volar/monaco expects.
	const webWorker = {
		getProxy: () => Promise.resolve(proxy),
		withSyncedResources(uris: monaco.Uri[]): Promise<WorkerLanguageService> {
			syncChain = syncChain.then(() => {
				const models: SyncModel[] = [];
				for (const uri of uris) {
					const model = monaco.editor.getModel(uri);
					if (model) {
						models.push({ uri: uri.toString(), version: model.getVersionId(), text: model.getValue() });
					}
				}
				return new Promise<void>(resolve => {
					syncResolve = resolve;
					post({ type: 'sync', models });
				});
			}).catch(() => { });
			return syncChain.then(() => proxy);
		},
		dispose() {
			disposed = true;
			worker.terminate();
		},
	} as unknown as VolarWorker;

	const disposables: monaco.IDisposable[] = [];

	const editor = monaco.editor as unknown as VolarEditor;
	const languages = monaco.languages as unknown as VolarLanguages;

	disposables.push(activateMarkers(webWorker, LANGUAGE_IDS, MARKERS_OWNER, getSyncUris, editor));
	disposables.push(activateAutoInsertion(webWorker, LANGUAGE_IDS, getSyncUris, editor));
	void registerProviders(webWorker, SELECTOR, getSyncUris, languages)
		.then(disposable => {
			if (disposed) disposable.dispose();
			else disposables.push(disposable);
		})
		.catch(error => console.warn('[dartsx-lang] provider registration failed', error));

	// @volar/monaco's markers only re-validate the model that changed. A
	// cross-file project means an edit in one tab can invalidate others —
	// re-request diagnostics for every project model (the worker recomputes
	// against the freshly synced project), so type errors surface in all
	// tabs. Same marker owner as volar's, so the changed model is simply
	// stamped twice with identical content. (The global content-change
	// event doesn't exist in this fork — host listeners per model.)
	let crossFileValidateTimer: ReturnType<typeof setTimeout> | undefined;
	const changeListeners = new Map<string, monaco.IDisposable>();

	function hostCrossFileValidation(model: monaco.editor.ITextModel): void {
		// Project models only (the caller's getSyncUris defines the set) —
		// e.g. the compiled-output model changes every compile and must not
		// trigger a pointless project re-validation.
		if (!getSyncUris().some(uri => uri.toString() === model.uri.toString())) return;
		const key = model.uri.toString();
		if (changeListeners.has(key)) return;
		changeListeners.set(key, model.onDidChangeContent(() => {
			clearTimeout(crossFileValidateTimer);
			crossFileValidateTimer = setTimeout(() => {
				if (!disposed) void validateProject();
			}, 300);
		}));
	}

	disposables.push(
		monaco.editor.onDidCreateModel(model => hostCrossFileValidation(model)),
		monaco.editor.onWillDisposeModel(model => {
			changeListeners.get(model.uri.toString())?.dispose();
			changeListeners.delete(model.uri.toString());
		}),
		{ dispose: () => { for (const d of changeListeners.values()) d.dispose(); } },
	);
	for (const model of monaco.editor.getModels()) hostCrossFileValidation(model);

	async function validateProject(): Promise<void> {
		// Bring the worker's mirrors up to date first — cross-file edits in
		// other tabs must be in the program before re-requesting markers.
		await webWorker.withSyncedResources(getSyncUris());
		for (const uri of getSyncUris()) {
			const model = monaco.editor.getModel(uri);
			if (!model || model.isDisposed()) continue;
			try {
				const diagnostics = await request('getDiagnostics', [nextId++, uri.toJSON()]);
				if (Array.isArray(diagnostics)) {
					monaco.editor.setModelMarkers(model, MARKERS_OWNER, (diagnostics as any[]).map(toMarkerData));
				}
			} catch {
				// worker rebuilding (tsconfig change) — the next round catches up
			}
		}
	}

	return {
		dispose() {
			disposed = true;
			for (const disposable of disposables) disposable.dispose();
			worker.terminate();
		},
	};
}
