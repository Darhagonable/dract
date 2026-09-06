// Compiler worker client: latest-request-wins RPC. A superseded compile
// never resolves — callers only ever want the newest result, and stale
// resolutions would race the output pane.

import CompilerWorker from './compiler.worker?worker';
import type { CompilerFile, CompileOutputs, FileOutput } from './types';

let worker: Worker | null = null;
let expectedId = 0;
let resolveLatest: ((outputs: CompileOutputs) => void) | null = null;
let ready: Promise<Worker> | null = null;

function ensureWorker(): Promise<Worker> {
	ready ??= new Promise((resolve, reject) => {
		const instance = new CompilerWorker();
		const onMessage = (event: MessageEvent<{ type: string }>) => {
			if (event.data?.type === 'ready') {
				instance.removeEventListener('message', onMessage);
				instance.removeEventListener('error', onError);
				instance.onmessage = onResult;
				resolve(instance);
			}
		};
		const onError = () => {
			instance.removeEventListener('message', onMessage);
			instance.removeEventListener('error', onError);
			ready = null;
			reject(new Error('compiler worker failed to boot'));
		};
		instance.addEventListener('message', onMessage);
		instance.addEventListener('error', onError);
	});
	return ready;
}

let onResult: (event: MessageEvent<{ type: string; id: number; outputs: CompileOutputs }>) => void;

onResult = (event) => {
	const data = event.data;
	if (data?.type !== 'result' || data.id !== expectedId || !resolveLatest) return;
	const resolve = resolveLatest;
	resolveLatest = null;
	resolve(data.outputs);
};

/** Compile a file set; resolves with the newest result, or null if superseded. */
export async function compile(files: CompilerFile[]): Promise<CompileOutputs | null> {
	const id = ++expectedId;
	// The caller may hand reactive state (proxied objects): structured clone
	// refuses proxies, so normalize to plain primitives first.
	const payload = files.map((file) => ({ name: file.name, source: file.source }));
	const instance = await ensureWorker();
	return new Promise((resolve) => {
		resolveLatest = resolve;
		instance.postMessage({ type: 'compile', id, files: payload });
	});
}

export type { CompilerFile, CompileOutputs, FileOutput };
