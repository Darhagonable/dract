// Model registry: playground files ⇄ monaco models.
//
// One persistent model per file under file:///project/<name>. Models are
// the live editing buffers; the app state is the file database. Content
// flows one way — model edits report upward via the change callback;
// wholesale file-set replacements (example loads) flow downward through
// syncFiles. The compiled-output model lives in its own dartsx-output:
// namespace so it can never join the language project.

import * as monaco from 'monaco-editor-core';
import './highlight';

const PROJECT_PREFIX = '/project/';
export const TSCONFIG_FILE = 'tsconfig.json';
const OUTPUT_URI = monaco.Uri.parse('dartsx-output:/compiled.js');

export interface PlaygroundFile {
	name: string;
	source: string;
}

export function projectUri(name: string): monaco.Uri {
	return monaco.Uri.file(PROJECT_PREFIX + name);
}

export function projectName(uri: monaco.Uri): string | null {
	return uri.scheme === 'file' && uri.path.startsWith(PROJECT_PREFIX)
		? uri.path.slice(PROJECT_PREFIX.length)
		: null;
}

function languageIdFor(name: string): string {
	if (name.endsWith('.tsx')) return 'typescriptreact';
	if (name.endsWith('.ts')) return 'typescript';
	if (name.endsWith('.json')) return 'json';
	return 'typescriptreact';
}

type SourceListener = (name: string, source: string) => void;

let sourceListener: SourceListener | null = null;

/** Set the singleton sink for project-model content changes. */
export function setSourceListener(listener: SourceListener): void {
	sourceListener = listener;
}

function bindListener(model: monaco.editor.ITextModel): void {
	model.onDidChangeContent(() => {
		const name = projectName(model.uri);
		if (name) sourceListener?.(name, model.getValue());
	});
}

/** Reconcile models with a file set: create missing, dispose gone, refresh content. */
export function syncFiles(files: PlaygroundFile[]): void {
	const wanted = new Set(files.map((file) => file.name));
	const bound = new Set<string>();

	for (const model of monaco.editor.getModels()) {
		const name = projectName(model.uri);
		if (!name) continue;
		if (!wanted.has(name)) model.dispose();
		else bound.add(name);
	}

	for (const file of files) {
		if (bound.has(file.name)) {
			const model = monaco.editor.getModel(projectUri(file.name));
			if (model && model.getValue() !== file.source) model.setValue(file.source);
			continue;
		}
		const model = monaco.editor.createModel(file.source, languageIdFor(file.name), projectUri(file.name));
		bindListener(model);
	}
}

/** All project file URIs except tsconfig.json — the language project. */
export function languageUris(): monaco.Uri[] {
	return monaco.editor
		.getModels()
		.map((model) => model.uri)
		.filter((uri) => {
			const name = projectName(uri);
			return name !== null && name !== TSCONFIG_FILE;
		});
}

export function getOutputModel(): monaco.editor.ITextModel {
	return (
		monaco.editor.getModel(OUTPUT_URI) ??
		monaco.editor.createModel('', 'javascript', OUTPUT_URI)
	);
}
