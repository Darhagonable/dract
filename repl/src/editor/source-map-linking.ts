import { TraceMap, originalPositionFor, generatedPositionFor, type SourceMapInput } from '@jridgewell/trace-mapping';
import * as monaco from 'monaco-editor';

let currentMap: TraceMap | null = null;

export function setSourceMap(mapData: SourceMapInput | null) {
	if (mapData) {
		currentMap = new TraceMap(mapData);
	} else {
		currentMap = null;
	}
}

export function setupSourceMapLinking(
	sourceEditor: monaco.editor.IStandaloneCodeEditor,
	outputEditor: monaco.editor.IStandaloneCodeEditor,
) {
	const sourceDecorations = sourceEditor.createDecorationsCollection([]);
	const outputDecorations = outputEditor.createDecorationsCollection([]);

	function clearAll() {
		sourceDecorations.clear();
		outputDecorations.clear();
	}

	sourceEditor.onMouseMove((e) => {
		if (!currentMap || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) {
			return;
		}
		const pos = e.target.position!;
		const genPos = generatedPositionFor(currentMap, { line: pos.lineNumber, column: pos.column });
		if (!genPos || genPos.line === null || genPos.column === null) {
			outputDecorations.clear();
			return;
		}
		const range = new monaco.Range(genPos.line, 1, genPos.line, 1);
		outputDecorations.set([{
			range,
			options: {
				isWholeLine: true,
				className: 'source-map-hover',
			},
		}]);
	});

	sourceEditor.onMouseLeave(() => {
		outputDecorations.clear();
		if (sourceDecorations.length > 0) clearAll();
	});

	outputEditor.onMouseMove((e) => {
		if (!currentMap || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) {
			return;
		}
		const pos = e.target.position!;
		const origPos = originalPositionFor(currentMap, { line: pos.lineNumber, column: pos.column });
		if (!origPos || origPos.line === null || origPos.column === null) {
			sourceDecorations.clear();
			return;
		}
		const range = new monaco.Range(origPos.line, 1, origPos.line, 1);
		sourceDecorations.set([{
			range,
			options: {
				isWholeLine: true,
				className: 'source-map-hover',
			},
		}]);
	});

	outputEditor.onMouseLeave(() => {
		sourceDecorations.clear();
	});
}
