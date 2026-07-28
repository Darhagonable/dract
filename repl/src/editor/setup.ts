import * as monaco from 'monaco-editor';

import { initialize } from '@codingame/monaco-vscode-api/services';
import { RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override';
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import languagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';

import '@codingame/monaco-vscode-theme-defaults-default-extension';

import editorWorkerUrl from '@codingame/monaco-vscode-api/workers/editor.worker?url';
import extensionHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?url';

import './dartsx-extension';

self.MonacoEnvironment = {
	getWorkerUrl(_: string, label: string) {
		if (label === 'editorWorkerService') {
			return editorWorkerUrl;
		}
		if (label === 'extensionHostWorkerMain') {
			return extensionHostWorkerUrl;
		}
	},
	getWorkerOptions(_: string, label: string) {
		if (label === 'extensionHostWorkerMain') {
			return { type: 'module' as const };
		}
		return undefined;
	},
} as any;

const SOURCE_URI = monaco.Uri.parse('file:///source.tsx');
let sourceFile: RegisteredMemoryFile | undefined;

export let sourceEditor: monaco.editor.IStandaloneCodeEditor;
export let outputEditor: monaco.editor.IStandaloneCodeEditor;

let sourceModel: monaco.editor.ITextModel;
let outputModel: monaco.editor.ITextModel;
let initialized = false;

export async function initEditors(container: HTMLElement, outputContainer: HTMLElement) {
	if (!initialized) {
		await initialize({
			...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
			...languagesServiceOverride(),
		});

		initialized = true;

		const provider = new RegisteredFileSystemProvider(false);
		sourceFile = new RegisteredMemoryFile(SOURCE_URI, '');
		provider.registerFile(sourceFile);
		registerFileSystemOverlay(1, provider);
	}

	sourceModel = monaco.editor.createModel('', 'typescript', SOURCE_URI);
	outputModel = monaco.editor.createModel('', 'javascript');

	sourceEditor = monaco.editor.create(container, {
		model: sourceModel,
		language: 'typescript',
		theme: 'vs-dark',
		fontSize: 14,
		lineNumbers: 'on',
		minimap: { enabled: false },
		automaticLayout: true,
		wordWrap: 'on',
		scrollBeyondLastLine: false,
		tabSize: 4,
		insertSpaces: false,
		renderWhitespace: 'selection',
	});

	outputEditor = monaco.editor.create(outputContainer, {
		model: outputModel,
		language: 'javascript',
		theme: 'vs-dark',
		fontSize: 14,
		lineNumbers: 'on',
		minimap: { enabled: false },
		automaticLayout: true,
		wordWrap: 'on',
		scrollBeyondLastLine: false,
		tabSize: 4,
		insertSpaces: false,
		readOnly: true,
		renderWhitespace: 'selection',
	});
}

export function setSourceContent(content: string) {
	if (sourceModel) {
		sourceModel.setValue(content);
		sourceFile?.write(new TextEncoder().encode(content)).catch(() => { });
	}
}

export function setOutputContent(js: string, css: string) {
	if (outputModel) {
		const display = css ? `/* ── CSS ───────────────────────────── */\n${css}\n\n/* ── JavaScript ─────────────────────── */\n${js}` : js;
		outputModel.setValue(display);
	}
}

export function getSourceContent(): string {
	return sourceModel?.getValue() || '';
}

export function getSourceModel() {
	return sourceModel;
}

export function getOutputModel() {
	return outputModel;
}
