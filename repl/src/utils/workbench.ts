// Lean editor host: monaco-editor-core + Shiki grammars (see highlight.ts)
// + our language worker (see src/language/). This replaces the former VS Code
// service-layer workbench: no extension host, no vsix — models are plain
// monaco models, editors are plain monaco editors, and the only workers are
// monaco's baseline editor worker and the DarTsx language worker.

import './highlight.ts';
import { themeName } from './highlight.ts';
import * as monaco from 'monaco-editor-core';
import editorWorker from 'monaco-editor-core/esm/vs/editor/editor.worker?worker';
import DartsxWorker from '../language/dartsx.worker?worker';

export { monaco };

// Workers must resolve before the first editor exists (this module loads
// first). The dartsx label is gated on the worker's lang-fs boot; everything
// else gets monaco's baseline editor worker.
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	async getWorker(_workerId: string, label: string): Promise<Worker> {
		if (label === 'dartsx') {
			const worker = new DartsxWorker();
			await new Promise<void>((resolve, reject) => {
				const fail = (event: ErrorEvent) => reject(new Error(event.message || 'dartsx worker failed to load'));
				worker.addEventListener('error', fail);
				worker.addEventListener('message', function onMessage(event: MessageEvent) {
					if (event.data === 'dartsx-ready') {
						worker.removeEventListener('message', onMessage);
						worker.removeEventListener('error', fail);
						resolve();
					} else if (event.data === 'dartsx-error') {
						worker.removeEventListener('message', onMessage);
						worker.removeEventListener('error', fail);
						reject(new Error('dartsx worker boot failed (lang-fs payload)'));
					}
				});
			});
			return worker;
		}
		return new editorWorker();
	},
};
// Configured editor factory for auxiliary editors (the compiled-output one).
// Kept as an export so consumers don't reach into monaco.editor.create with
// half the options.
export const createEditor = (container: HTMLElement, options: monaco.editor.IStandaloneEditorConstructionOptions) =>
	monaco.editor.create(container, options);

export const PROJECT_PATH_PREFIX = '/tmp/project/';

export function projectUri(name: string): monaco.Uri {
	return monaco.Uri.file(PROJECT_PATH_PREFIX + name);
}

export function projectName(uri: monaco.Uri): string | null {
	return uri.scheme === 'file' && uri.path.startsWith(PROJECT_PATH_PREFIX)
		? uri.path.slice(PROJECT_PATH_PREFIX.length)
		: null;
}

function languageIdFor(name: string): string {
	if (name.endsWith('.tsx')) return 'typescriptreact';
	if (name.endsWith('.ts')) return 'typescript';
	if (name.endsWith('.json')) return 'json';
	return 'typescriptreact';
}

export const registeredNames = new Set<string>();

export function registerWorkspaceFile(name: string, source: string): void {
	if (registeredNames.has(name)) return;
	registeredNames.add(name);
	monaco.editor.createModel(source, languageIdFor(name), projectUri(name));
}

export function unregisterWorkspaceFile(name: string): void {
	registeredNames.delete(name);
	disposeWorkspaceModel(name);
}

export function ensureWorkspaceModel(name: string): void {
	// registerWorkspaceFile already created the model; kept for call-site
	// stability with the former async workbench.
}

export function disposeWorkspaceModel(name: string): void {
	monaco.editor.getModel(projectUri(name))?.dispose();
}

export interface BootOptions {
	/** Editor mount point (a single bare editor swaps models per open tab). */
	container: HTMLElement;
	files: { name: string; source: string }[];
	entry: string;
	dark: boolean;
	onDocumentChanged?: (name: string, text: string) => void;
}

export interface Workbench {
	openFile(name: string): Promise<void>;
	getActiveEditor(): monaco.editor.ICodeEditor | null;
	setTheme(dark: boolean): void;
}

let bootPromise: Promise<Workbench> | null = null;

// The workbench is a page-wide singleton: highlight.ts registers grammars and
// themes exactly once per document, so repeated mounts reuse the first boot.
export function bootWorkbench(options: BootOptions): Promise<Workbench> {
	bootPromise ??= doBoot(options);
	return bootPromise;
}

async function doBoot(options: BootOptions): Promise<Workbench> {
	monaco.editor.setTheme(themeName(options.dark));

	for (const file of options.files) {
		registerWorkspaceFile(file.name, file.source);
	}

	if (options.onDocumentChanged) {
		// Register for future models too (file add/rename).
		monaco.editor.onDidCreateModel(model => {
			const name = projectName(model.uri);
			if (!name) return;
			model.onDidChangeContent(() => options.onDocumentChanged!(name, model.getValue()));
		});
		for (const model of monaco.editor.getModels()) {
			const name = projectName(model.uri);
			if (!name) continue;
			model.onDidChangeContent(() => options.onDocumentChanged!(name, model.getValue()));
		}
	}

	// One bare Monaco editor for every project file — no workbench chrome,
	// just the core editor swapping models per open tab.
	let editor: monaco.editor.IStandaloneCodeEditor | null = null;

	async function ensureEditor(model: monaco.editor.ITextModel): Promise<monaco.editor.IStandaloneCodeEditor> {
		if (editor) {
			editor.setModel(model);
			editor.focus();
			return editor;
		}
		editor = monaco.editor.create(options.container, {
			model,
			lineNumbers: 'on',
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			automaticLayout: true,
			renderLineHighlight: 'none',
			fixedOverflowWidgets: true,
		});
		return editor;
	}

	return {
		async openFile(name: string) {
			const model = monaco.editor.getModel(projectUri(name));
			if (!model) throw new Error(`[dartsx-playground] no model for ${name}`);
			await ensureEditor(model);
		},
		getActiveEditor() {
			const model = editor?.getModel();
			if (!model || !projectName(model.uri)) return null;
			return editor as unknown as monaco.editor.ICodeEditor;
		},
		setTheme(dark: boolean) {
			monaco.editor.setTheme(themeName(dark));
		},
	};
}
