// Main-thread half of the DarTsx language worker (see dartsx.worker.ts).
//
// The vue-repl wiring: @volar/monaco's activateMarkers + activateAutoInsertion
// + registerProviders over a native monaco-editor-core web worker. All
// project models stay mirrored (keepIdleModels), so the worker type-checks
// every file — not just the open tab.
//
// Two additions over the stock wiring:
// - cross-file revalidation: activateMarkers only revalidates the model that
//   changed; an edit in one file can invalidate others, so any project model
//   change re-requests diagnostics for the whole set (debounced)
// - tsconfig reactivity: reloadLanguage() tears the worker down and boots a
//   fresh one with new compilerOptions (Vue's reloadLanguageTools pattern)

import * as monaco from 'monaco-editor-core';
import { activateAutoInsertion, activateMarkers, registerProviders } from '@volar/monaco';
import type { WorkerLanguageService } from '@volar/monaco/worker';
import { toMarkerData } from 'monaco-languageserver-types';
import { projectName } from '../editor/models';

const MARKERS_OWNER = 'dartsx';
const LANGUAGE_IDS = ['typescript', 'typescriptreact'];
const SELECTOR: monaco.languages.LanguageSelector = LANGUAGE_IDS.map((language) => ({ language }));

export interface LanguageHost {
	/** URIs of all project files (the language project). */
	getSyncUris(): monaco.Uri[];
	/** Raw tsconfig compilerOptions, or null while unparseable. */
	getCompilerOptions(): Record<string, unknown> | null;
}

const REVALIDATE_DEBOUNCE_MS = 300;

let host: LanguageHost | null = null;
let disposeCurrent: (() => void) | null = null;

export function mountLanguage(languageHost: LanguageHost): void {
	host = languageHost;
	void boot();
}

export function reloadLanguage(): void {
	if (!host) return;
	void boot();
}

async function boot(): Promise<void> {
	disposeCurrent?.();
	disposeCurrent = null;

	const worker = monaco.editor.createWebWorker<WorkerLanguageService>({
		moduleId: 'dartsx/language',
		label: 'dartsx',
		createData: { compilerOptions: host!.getCompilerOptions() },
		keepIdleModels: true,
	});

	const disposables: monaco.IDisposable[] = [];

	disposables.push(
		activateMarkers(worker, LANGUAGE_IDS, MARKERS_OWNER, () => host!.getSyncUris(), monaco.editor),
		activateAutoInsertion(worker, LANGUAGE_IDS, () => host!.getSyncUris(), monaco.editor),
	);
	const providers = await registerProviders(worker, SELECTOR, () => host!.getSyncUris(), monaco.languages);
	if (disposables.length) disposables.push(providers);
	else providers.dispose();

	// Cross-file revalidation.
	let timer: ReturnType<typeof setTimeout> | undefined;
	const watched = new Map<string, monaco.IDisposable>();

	function watchModel(model: monaco.editor.ITextModel): void {
		if (projectName(model.uri) === null) return;
		const key = model.uri.toString();
		if (watched.has(key)) return;
		watched.set(
			key,
			model.onDidChangeContent(() => {
				clearTimeout(timer);
				timer = setTimeout(() => void revalidate(), REVALIDATE_DEBOUNCE_MS);
			}),
		);
	}

	disposables.push(
		monaco.editor.onDidCreateModel(watchModel),
		monaco.editor.onWillDisposeModel((model) => {
			watched.get(model.uri.toString())?.dispose();
			watched.delete(model.uri.toString());
		}),
		{
			dispose() {
				clearTimeout(timer);
				for (const disposable of watched.values()) disposable.dispose();
				watched.clear();
			},
		},
	);
	for (const model of monaco.editor.getModels()) watchModel(model);

	let nextRequestId = 1;

	async function revalidate(): Promise<void> {
		try {
			const proxy = await worker.getProxy();
			const uris = host!.getSyncUris();
			await worker.withSyncedResources(uris);
			for (const uri of uris) {
				const model = monaco.editor.getModel(uri);
				if (!model || model.isDisposed()) continue;
				const diagnostics = await proxy.getDiagnostics(nextRequestId++, uri);
				if (Array.isArray(diagnostics)) {
					monaco.editor.setModelMarkers(model, MARKERS_OWNER, (diagnostics as never[]).map(toMarkerData));
				}
			}
		} catch {
			// worker is rebuilding — the next round catches up
		}
	}

	disposeCurrent = () => {
		for (const disposable of disposables) disposable.dispose();
		worker.dispose();
	};

	void revalidate();
}
