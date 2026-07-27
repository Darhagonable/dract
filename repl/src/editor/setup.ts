import * as monaco from 'monaco-editor';
import { dartsxMonarchLanguage } from './dartsx-language';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

;(self as any).MonacoEnvironment = {
	getWorker(_: any, label: string) {
		if (label === 'typescript' || label === 'javascript') {
			return new tsWorker();
		}
		return new editorWorker();
	},
};

export let sourceEditor: monaco.editor.IStandaloneCodeEditor;
export let outputEditor: monaco.editor.IStandaloneCodeEditor;

let sourceModel: monaco.editor.ITextModel;
let outputModel: monaco.editor.ITextModel;

export function initEditors(container: HTMLElement, outputContainer: HTMLElement) {
	monaco.languages.register({ id: 'dartsx' });
	monaco.languages.setMonarchTokensProvider('dartsx', dartsxMonarchLanguage);

	monaco.languages.register({ id: 'dartsx-output' });
	monaco.languages.setMonarchTokensProvider('dartsx-output', {
		tokenizer: {
			root: [
				[/\/\/.*$/, 'comment'],
				[/\/\*/, 'comment', '@comment'],
				[/'.*?'/, 'string'],
				[/".*?"/, 'string'],
				[/`[\s\S]*?`/, 'string'],
				[/\b(import|export|from|default|const|let|var|function|return|if|for|while|class|new|this)\b/, 'keyword'],
				[/\b(true|false|null|undefined|NaN|Infinity)\b/, 'constant'],
				[/\b(\d+\.?\d*)\b/, 'number'],
				[/\$\.[a-zA-Z_]\w*/, 'function'],
				[/[{}()\[\];,:]/, 'delimiter'],
				[/\b[a-zA-Z_]\w*\s*(?=\()/, 'function'],
			],
			comment: [
				[/[^/*]+/, 'comment'],
				[/\*\//, 'comment', '@pop'],
				[/[/*]/, 'comment'],
			],
		},
	} as any);

	sourceModel = monaco.editor.createModel('', 'dartsx');
	outputModel = monaco.editor.createModel('', 'dartsx-output');

	sourceEditor = monaco.editor.create(container, {
		model: sourceModel,
		language: 'dartsx',
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
		language: 'dartsx-output',
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
