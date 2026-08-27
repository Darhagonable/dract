// Browser editor hosting the real DarTsx extension.
//
// This mirrors fengkx/beancount-lsp's playground: @codingame/monaco-vscode-api
// boots VS Code's service layer (no workbench UI) with an extension host
// worker, and the extension's built .vsix (copied next to this app by
// scripts/prepare-vsix.mjs) is installed into it — so grammar highlighting,
// semantic tokens, and diagnostics come from the exact code desktop VS Code
// runs. The visible editors are plain Monaco editors we create ourselves and
// attach to the container.
//
// typescriptServerPlugins cannot run in a browser extension host, so TS
// features (hover, type errors, completions) come from the language worker
// in src/language/ instead — the same DarTsx transform and post-processing
// the desktop tsserver plugin applies, on @volar/monaco. The Volar CSS/HTML
// server is also Node-side only; its web wiring is a possible follow-up.
import '@codingame/monaco-editor-wrapper/features/extensionHostWorker';
import '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/codelens/browser/codelensController';
import '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/suggest/browser/suggestController';
import '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/snippet/browser/snippetController2';

import { whenReady as extensionVsixReady } from '../../dartsx.vsix';
import {
	createEditor,
	createModelReference,
	initialize,
	registerFile,
	updateUserConfiguration,
} from '@codingame/monaco-editor-wrapper';
import { getService } from '@codingame/monaco-vscode-api';
import { IExtensionService } from '@codingame/monaco-vscode-api/services';
import { ExtensionIdentifier } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import { RegisteredMemoryFile } from '@codingame/monaco-vscode-files-service-override';
import * as vscode from 'vscode';
import * as monaco from 'monaco-editor';

export { monaco };
// Configured editor factory: creates editors wired to the engine's services
// (theme, configuration, keybindings). Callers outside this module (the
// compiled-output editor) should use it too, not plain monaco.editor.create.
export { createEditor };

export const PROJECT_PATH_PREFIX = '/tmp/project/';
export const EXTENSION_ID = 'dartsx.vscode-extension';

export function projectUri(name: string): monaco.Uri {
	return monaco.Uri.file(PROJECT_PATH_PREFIX + name);
}

export function projectName(uri: monaco.Uri): string | null {
	return uri.scheme === 'file' && uri.path.startsWith(PROJECT_PATH_PREFIX)
		? uri.path.slice(PROJECT_PATH_PREFIX.length)
		: null;
}

const DARK_THEME = 'Default Dark Modern';
const LIGHT_THEME = 'Default Light Modern';

function baseUserConfiguration(dark: boolean): string {
	return JSON.stringify({
		'workbench.colorTheme': dark ? DARK_THEME : LIGHT_THEME,
		'editor.minimap.enabled': false,
		'editor.stickyScroll.enabled': false,
	});
}

export const registeredNames = new Set<string>();

// Model references for EVERY workspace file, not just the opened tab. The
// language worker syncs monaco models (see src/language/), so cross-file
// type checking requires a model to exist per file — the vue repl does the
// same with its getOrCreateModel loop. References are held forever: models
// must survive tab switches.
const fileModelReferences = new Map<string, { dispose(): void }>();

export function registerWorkspaceFile(name: string, source: string): void {
	if (registeredNames.has(name)) return;
	registeredNames.add(name);
	registerFile(new RegisteredMemoryFile(projectUri(name), source));
}

export function unregisterWorkspaceFile(name: string): void {
	registeredNames.delete(name);
	disposeWorkspaceModel(name);
}

export async function ensureWorkspaceModel(name: string): Promise<void> {
	if (fileModelReferences.has(name)) return;
	fileModelReferences.set(name, await createModelReference(projectUri(name)));
}

export function disposeWorkspaceModel(name: string): void {
	fileModelReferences.get(name)?.dispose();
	fileModelReferences.delete(name);
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

// The engine is a page-wide singleton: initialize() may run exactly once
// per document, so repeated mounts reuse the first boot.
export function bootWorkbench(options: BootOptions): Promise<Workbench> {
	bootPromise ??= doBoot(options);
	return bootPromise;
}

async function doBoot(options: BootOptions): Promise<Workbench> {
	for (const file of options.files) {
		registerWorkspaceFile(file.name, file.source);
	}
	updateUserConfiguration(baseUserConfiguration(options.dark));
	// Theme classes + theme-scoped CSS are stamped on document.body (the
	// engine's default container): it is an ancestor of EVERY editor — the
	// compiled-output one lives outside the mount container — and React never
	// rewrites body's className, so the stamps survive re-renders (a
	// React-managed container gets its classes wiped on the next render).
	await initialize({}, {});
	await extensionVsixReady;

	try {
		const extensionService = await getService(IExtensionService);
		await extensionService.whenInstalledExtensionsRegistered();
		await extensionService.activateById(new ExtensionIdentifier(EXTENSION_ID), {
			startup: false,
			extensionId: new ExtensionIdentifier(EXTENSION_ID),
			activationEvent: 'onDemand',
		});
	} catch (error) {
		console.error('[dartsx-playground] extension activation failed', error);
	}

	// A model per workspace file so the language worker sees the whole
	// project, not just the opened tab (cross-file type checking).
	await Promise.all([...registeredNames].map(name => ensureWorkspaceModel(name)));

	if (options.onDocumentChanged) {
		vscode.workspace.onDidChangeTextDocument((event) => {
			const name = projectName(event.document.uri);
			if (name) options.onDocumentChanged!(name, event.document.getText());
		});
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
		editor = createEditor(options.container, {
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
			// Model references keep the document registered with the engine's
			// model service (and thus the extension host). References are held
			// forever on purpose: models must survive tab switches, matching
			// what the consumer expects from monaco.editor.getModel().
			const uri = projectUri(name);
			const reference = await createModelReference(uri);
			const model = reference.object.textEditorModel ?? monaco.editor.getModel(uri);
			if (!model) throw new Error(`[dartsx-playground] no model for ${name}`);
			await ensureEditor(model);
		},
		getActiveEditor() {
			const model = editor?.getModel();
			if (!model || !projectName(model.uri)) return null;
			return editor as unknown as monaco.editor.ICodeEditor;
		},
		setTheme(dark: boolean) {
			updateUserConfiguration(baseUserConfiguration(dark));
		},
	};
}
