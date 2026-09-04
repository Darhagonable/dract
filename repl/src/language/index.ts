// Main-thread half of the DarTsx language worker (see dartsx.worker.ts for
// the architecture overview). vue-repl wiring: @volar/monaco's
// activateMarkers + registerProviders + activateAutoInsertion on a native
// monaco-editor-core web worker — no custom transport needed here (that shim
// existed only because the codingame fork removed createWebWorker).

import * as monaco from 'monaco-editor-core';
import { activateAutoInsertion, activateMarkers, registerProviders } from '@volar/monaco';
import type { WorkerLanguageService } from '@volar/monaco/worker';
import { toMarkerData } from 'monaco-languageserver-types';

const MARKERS_OWNER = 'dartsx-ts';
const LANGUAGE_IDS = ['typescript', 'typescriptreact'];
const SELECTOR: monaco.languages.LanguageSelector = LANGUAGE_IDS.map(language => ({ language }));

export interface DartsxLanguageService {
	dispose(): void;
}

export function createDartsxLanguageService(
	getSyncUris: () => monaco.Uri[],
	getCompilerOptions: () => Record<string, unknown> | null,
): DartsxLanguageService {
	const worker = monaco.editor.createWebWorker<WorkerLanguageService>({
		moduleId: 'dartsx/language',
		label: 'dartsx',
		createData: { compilerOptions: getCompilerOptions() },
		// Non-open project models stay mirrored — cross-file type checking
		// reads them between tab switches.
		keepIdleModels: true,
	});

	const disposables: monaco.IDisposable[] = [];

	disposables.push(activateMarkers(worker, LANGUAGE_IDS, MARKERS_OWNER, getSyncUris, monaco.editor));
	disposables.push(activateAutoInsertion(worker, LANGUAGE_IDS, getSyncUris, monaco.editor));
	void registerProviders(worker, SELECTOR, getSyncUris, monaco.languages)
		.then(disposable => {
			if (disposables.length) disposables.push(disposable);
			else disposable.dispose(); // already torn down
		})
		.catch(error => console.warn('[dartsx-lang] provider registration failed', error));

	// @volar/monaco's markers only re-validate the model that changed. A
	// cross-file project means an edit in one tab can invalidate others —
	// re-request diagnostics for every project model, so type errors surface
	// in all tabs. Same marker owner as volar's, so the changed model is
	// simply stamped twice with identical content.
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
				void validateProject();
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

	let nextRequestId = 1;

	async function validateProject(): Promise<void> {
		try {
			const proxy = await worker.getProxy();
			await worker.withSyncedResources(getSyncUris());
			for (const uri of getSyncUris()) {
				const model = monaco.editor.getModel(uri);
				if (!model || model.isDisposed()) continue;
				const diagnostics = await proxy.getDiagnostics(nextRequestId++, uri);
				if (Array.isArray(diagnostics)) {
					monaco.editor.setModelMarkers(model, MARKERS_OWNER, (diagnostics as never[]).map(toMarkerData));
				}
			}
		} catch {
			// worker rebuilding — the next round catches up
		}
	}

	return {
		dispose() {
			for (const disposable of disposables) disposable.dispose();
			worker.dispose();
		},
	};
}
