// Browser VS Code workbench hosting the real DarTsx extension.
//
// This mirrors fengkx/beancount-lsp's playground: @codingame/monaco-vscode-api
// boots enough of VS Code to run an extension host worker in the browser, and
// the extension's built .vsix (copied next to this app by scripts/
// prepare-vsix.mjs) is installed into it — so grammar highlighting, semantic
// tokens, and diagnostics come from the exact code desktop VS Code runs.
//
// Limitation inherited from the platform: typescriptServerPlugins cannot run
// in a browser extension host, so TS-service-powered hovers/type errors stay
// desktop-only here. The Volar CSS/HTML server is also Node-side only; its
// web wiring is a possible follow-up.
import '@codingame/monaco-editor-wrapper/features/workbench';
import '@codingame/monaco-editor-wrapper/features/search';
import '@codingame/monaco-editor-wrapper/features/extensionHostWorker';
import '@codingame/monaco-editor-wrapper/features/viewPanels';
import '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/codelens/browser/codelensController';
import '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/suggest/browser/suggestController';
import '@codingame/monaco-vscode-api/vscode/vs/editor/contrib/snippet/browser/snippetController2';

import { whenReady as extensionVsixReady } from '../../dartsx.vsix';
import { initialize, registerFile, updateUserConfiguration } from '@codingame/monaco-editor-wrapper';
import { getService } from '@codingame/monaco-vscode-api';
import { IExtensionService } from '@codingame/monaco-vscode-api/services';
import { IEditorService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service';
import type { IEditorService as IEditorServiceType } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service';
import { ExtensionIdentifier } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import { RegisteredMemoryFile } from '@codingame/monaco-vscode-files-service-override';
import * as vscode from 'vscode';
import * as monaco from 'monaco-editor';

export { monaco };

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
		// Our own tab strip drives navigation; the workbench chrome stays out
		// of the way so the embedded editor reads like the CodeMirror one did.
		'workbench.editor.showTabs': false,
		'workbench.activityBar.location': 'hidden',
		'workbench.statusBar.visible': false,
		'workbench.startupEditor': 'none',
		'editor.minimap.enabled': false,
		'breadcrumbs.enabled': false,
		'editor.stickyScroll.enabled': false,
	});
}

export const registeredNames = new Set<string>();

export function registerWorkspaceFile(name: string, source: string): void {
	if (registeredNames.has(name)) return;
	registeredNames.add(name);
	registerFile(new RegisteredMemoryFile(projectUri(name), source));
}

export function unregisterWorkspaceFile(name: string): void {
	registeredNames.delete(name);
}

export interface BootOptions {
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

// The workbench is a page-wide singleton: initialize() may run exactly once
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

	await initialize({}, { container: options.container });
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

	if (options.onDocumentChanged) {
		vscode.workspace.onDidChangeTextDocument((event) => {
			const name = projectName(event.document.uri);
			if (name) options.onDocumentChanged!(name, event.document.getText());
		});
	}

	const editorService = await getService(IEditorService) as IEditorServiceType;

	return {
		async openFile(name: string) {
			await editorService.openEditor({ resource: projectUri(name) });
		},
		getActiveEditor() {
			for (const candidate of monaco.editor.getEditors()) {
				const model = candidate.getModel();
				if (model && projectName(model.uri)) return candidate as monaco.editor.ICodeEditor;
			}
			return null;
		},
		setTheme(dark: boolean) {
			updateUserConfiguration(baseUserConfiguration(dark));
		},
	};
}
