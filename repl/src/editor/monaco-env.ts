// Monaco environment: worker wiring.
//
// Two workers exist: monaco's baseline editor worker, and the DarTsx
// language worker (src/language/dartsx.worker.ts). The language worker must
// mount its type payload (/dartsx-lang-fs.json) before monaco's $initialize
// handshake reaches it, so getWorker awaits the worker's 'dartsx-ready'
// message before handing it over — monaco's protocol has no boot barrier of
// its own.

import * as monaco from 'monaco-editor-core';
import editorWorker from 'monaco-editor-core/esm/vs/editor/editor.worker?worker';
import DartsxWorker from '../language/dartsx.worker?worker';

function createDartsxWorker(): Promise<Worker> {
	return new Promise((resolve, reject) => {
		const worker = new DartsxWorker();
		const onMessage = (event: MessageEvent) => {
			if (event.data === 'dartsx-ready') {
				cleanup();
				resolve(worker);
			} else if (event.data === 'dartsx-error') {
				cleanup();
				reject(new Error('dartsx language worker boot failed (language FS payload)'));
			}
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			const detail = event.message
				? `: ${event.message}`
				: event.filename
					? ` at ${event.filename}:${event.lineno}`
					: '';
			reject(new Error(`dartsx language worker failed to load${detail}`));
		};
		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
	});
}

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	async getWorker(_workerId: string, label: string): Promise<Worker> {
		if (label === 'dartsx') {
			return createDartsxWorker();
		}
		return new editorWorker();
	},
};

export { monaco };
