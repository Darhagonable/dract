// Compiler worker client: latest-request-wins RPC. A superseded compile
// never resolves — callers only ever want the newest result, and stale
// resolutions would race the output pane. The worker posts a 'ready' boot
// signal that gates the first compile: a message posted before the module
// graph (and the oxc wasm runtime it carries) has finished evaluating can
// be lost. A crashed worker resets the boot promise, so the next compile
// rebuilds it.

import CompilerWorker from './compiler.worker?worker';
import type { CompilerFile, CompileResult, FileOutput } from './types';

let instance: Worker | null = null;
let expectedId = 0;
let resolveLatest: ((result: CompileResult) => void) | null = null;
let ready: Promise<Worker> | null = null;

function onResult(event: MessageEvent<{ type: string; id: number } & CompileResult>): void {
	const data = event.data;
	if (data?.type !== 'result' || data.id !== expectedId || !resolveLatest) return;
	const resolve = resolveLatest;
	resolveLatest = null;
	resolve({ outputs: data.outputs, graph: data.graph, graphError: data.graphError });
}

function ensureWorker(): Promise<Worker> {
	if (instance) return Promise.resolve(instance);
	ready ??= new Promise<Worker>((resolve, reject) => {
		const worker = new CompilerWorker();
		const onMessage = (event: MessageEvent<{ type: string }>) => {
			if (event.data?.type !== 'ready') return;
			cleanup();
			worker.onmessage = onResult;
			// A crash after boot must not leave compiles posting into a dead
			// worker: drop the instance so the next compile rebuilds it.
			worker.onerror = (event: ErrorEvent) => {
				console.error('[compiler-worker] crashed', event.message ?? '');
				if (instance === worker) {
					instance = null;
					ready = null;
				}
			};
			instance = worker;
			resolve(worker);
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			worker.terminate();
			const detail = event.message
				? `: ${event.message}`
				: event.filename
					? ` at ${event.filename}:${event.lineno}`
					: '';
			reject(new Error(`compiler worker failed to load${detail}`));
		};
		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
	});
	return ready;
}

/** Compile a file set; resolves with the newest result, or null if superseded. */
export async function compile(files: CompilerFile[]): Promise<CompileResult | null> {
	const id = ++expectedId;
	// The caller may hand reactive state (proxied objects): structured clone
	// refuses proxies, so normalize to plain primitives first.
	const payload = files.map((file) => ({ name: file.name, source: file.source }));
	const worker = await ensureWorker();
	return new Promise((resolve) => {
		resolveLatest = resolve;
		worker.postMessage({ type: 'compile', id, entry: files[0].name, files: payload });
	});
}

export type { CompilerFile, CompileResult, FileOutput };
