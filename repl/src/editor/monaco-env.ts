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

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	async getWorker(_workerId: string, label: string): Promise<Worker> {
		if (label === 'dartsx') {
			const worker = new DartsxWorker();
			await new Promise<void>((resolve, reject) => {
				const onMessage = (event: MessageEvent) => {
					if (event.data === 'dartsx-ready') {
						cleanup();
						resolve();
					} else if (event.data === 'dartsx-error') {
						cleanup();
						reject(new Error('dartsx language worker boot failed (language FS payload)'));
					}
				};
				const onError = () => {
					cleanup();
					reject(new Error('dartsx language worker failed to load'));
				};
				const cleanup = () => {
					worker.removeEventListener('message', onMessage);
					worker.removeEventListener('error', onError);
				};
				worker.addEventListener('message', onMessage);
				worker.addEventListener('error', onError);
			});
			return worker;
		}
		return new editorWorker();
	},
};

export { monaco };
