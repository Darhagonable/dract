// Editor views: one editable input editor and one read-only output editor.
//
// A single editor instance swaps models per active file (monaco's native
// multi-model pattern); per-file view state is saved and restored across
// switches. Go-to-definition onto another project file resolves through
// registerEditorOpener back into the app.

import * as monaco from 'monaco-editor-core';
import './monaco-env';
import './highlight';
import { getOutputModel, projectName, projectUri, setSourceListener } from './models';

export interface EditorHost {
	/** A project model's content changed. */
	onSourceChange(name: string, source: string): void;
	/** A project file was revealed (go-to-definition) and should become active. */
	onOpenFile(name: string): void;
}

const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

let input: monaco.editor.IStandaloneCodeEditor | null = null;
let output: monaco.editor.IStandaloneCodeEditor | null = null;
let activeName: string | null = null;
let host: EditorHost | null = null;

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
	lineNumbers: 'on',
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	automaticLayout: true,
	fixedOverflowWidgets: true,
	tabSize: 2,
	fontSize: 13,
};

export function mountEditors(inputContainer: HTMLElement, outputContainer: HTMLElement, editorHost: EditorHost): void {
	if (input) return;
	host = editorHost;
	setSourceListener(editorHost.onSourceChange);

	input = monaco.editor.create(inputContainer, {
		...EDITOR_OPTIONS,
		model: null,
	});

	output = monaco.editor.create(outputContainer, {
		...EDITOR_OPTIONS,
		model: getOutputModel(),
		readOnly: true,
		wordWrap: 'on',
	});

	monaco.editor.registerEditorOpener({
		openCodeEditor(_editor, resource) {
			const name = projectName(resource);
			if (!name) return false;
			host?.onOpenFile(name);
			return true;
		},
	});
}

/** Show a project file in the input editor, preserving per-file view state. */
export function openFile(name: string): void {
	if (!input) return;
	const model = monaco.editor.getModel(projectUri(name));
	if (!model) return;
	if (activeName && activeName !== name) viewStates.set(activeName, input.saveViewState());
	activeName = name;
	input.setModel(model);
	const state = viewStates.get(name);
	if (state) input.restoreViewState(state);
	input.focus();
}

/** Update the read-only compiled-output view. */
export function setOutput(text: string): void {
	const model = getOutputModel();
	if (model.getValue() !== text) model.setValue(text);
}
