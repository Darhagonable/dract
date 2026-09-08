// Preview sandbox: a sandboxed iframe (opaque origin — deliberately no
// allow-same-origin) executing the compiled module graph.
//
// The parent hands over the dartsx runtime as text; the iframe blob-ifies
// it and installs an import map (both dartsx specifiers → one blob, so the
// runtime is a single module instance). User modules arrive from the
// compiler worker with relative imports already rewritten to module tokens
// (one definition in compiler/types.ts, interpolated below); the bootstrap
// materializes each module lazily and recursively — tokens resolve to
// already-created blob URLs, which determines dependency order by
// construction and detects import cycles.
//
// Protocol (generation-guarded; each run fully tears down and remounts):
//   parent → iframe: init {code}   run {gen, entry, modules}
//   iframe → parent: boot          ready {error?}
//                   result {gen, error?}

import type { PreviewGraph } from '../compiler/types';
import { MODULE_TOKEN_PATTERN_SOURCE, MODULE_TOKEN_PREFIX, MODULE_TOKEN_SUFFIX } from '../compiler/types';

const SANDBOX_FLAGS =
	'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-pointer-lock';

const BOOT_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 10_000;

const SANDBOX_HTML = `<!doctype html>
<html>
<head>
<script>
(() => {
	'use strict';
	const TOKEN_PREFIX = ${JSON.stringify(MODULE_TOKEN_PREFIX)};
	const TOKEN_SUFFIX = ${JSON.stringify(MODULE_TOKEN_SUFFIX)};
	const TOKEN_PATTERN = new RegExp(${JSON.stringify(MODULE_TOKEN_PATTERN_SOURCE)});
	const post = (message) => parent.postMessage(message, '*');
	const blobs = new Map();
	const byName = new Map();
	let runtime = null;
	let gen = 0;

	post({ type: 'boot' });

	self.addEventListener('error', (event) => {
		post({ type: 'runtime-error', gen, error: event.message || 'unknown error' });
	});
	self.addEventListener('unhandledrejection', (event) => {
		post({ type: 'runtime-error', gen, error: String(event.reason && event.reason.message || event.reason) });
	});

	async function materialize(name) {
		const token = TOKEN_PREFIX + name + TOKEN_SUFFIX;
		if (blobs.has(token)) {
			const url = blobs.get(token);
			if (url) return url;
			throw new Error('Circular import involving ' + name);
		}
		blobs.set(token, null);
		const module = byName.get(name);
		if (!module) throw new Error('Unknown module: ' + name);
		const parts = module.code.split(TOKEN_PATTERN);
		let code = '';
		for (let i = 0; i < parts.length; i++) {
			if (i % 2 === 0) { code += parts[i]; continue; }
			code += await materialize(parts[i]);
		}
		const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
		blobs.set(token, url);
		return url;
	}

	function findComponent(mod) {
		if (typeof mod.default === 'function') return mod.default;
		if (typeof mod.App === 'function') return mod.App;
		for (const value of Object.values(mod)) {
			if (typeof value === 'function') return value;
		}
		throw new Error('Entry module exports no component');
	}

	self.onmessage = async (event) => {
		const message = event.data;
		if (!message || typeof message !== 'object') return;

		if (message.type === 'init') {
			try {
				const url = URL.createObjectURL(new Blob([message.code], { type: 'text/javascript' }));
				const importMap = document.createElement('script');
				importMap.type = 'importmap';
				importMap.textContent = JSON.stringify({
					imports: {
						'dartsx': url,
						'dartsx/internal/client': url,
						'dartsx/jsx-runtime': url,
						'dartsx/jsx-dev-runtime': url,
					},
				});
				// The import map must exist before any module load — nothing
				// has imported a module yet, so appending is legal.
				document.head.appendChild(importMap);
				runtime = await import(url);
				post({ type: 'ready' });
			} catch (error) {
				post({ type: 'ready', error: String(error && error.message || error) });
			}
			if (runtime && pendingRun) {
				const run = pendingRun;
				pendingRun = null;
				void doRun(run);
			}
			return;
		}

		if (message.type === 'run') {
			gen = message.gen;
			// A run may arrive before init completes (parent boot guard is
			// time-based) — queue it rather than racing a null runtime.
			if (!runtime) {
				pendingRun = message;
				return;
			}
			await doRun(message);
		}
	};

	let pendingRun = null;

	async function doRun(message) {
		for (const url of blobs.values()) if (url) URL.revokeObjectURL(url);
		blobs.clear();
		byName.clear();
		for (const module of message.modules) byName.set(module.name, module);
		document.getElementById('root').innerHTML = '';
		try {
			const entryUrl = await materialize(message.entry);
			const mod = await import(entryUrl);
			runtime.mount(findComponent(mod), document.getElementById('root'));
			post({ type: 'result', gen });
		} catch (error) {
			post({ type: 'result', gen, error: String(error && error.stack || error) });
		}
	}
})();
</script>
</head>
<body>
	<div id="root"></div>
</body>
</html>`;

export interface Preview {
	/** Run a graph; resolves with a mount error or null. Superseded runs resolve null. */
	run(graph: PreviewGraph): Promise<{ error: string | null }>;
	/** Show a non-run failure in the pane (e.g. a graph that could not be built). */
	reportError(message: string): void;
	destroy(): void;
}

export interface PreviewHost {
	/** A runtime error from the current generation (effects, handlers). */
	onRuntimeError?(message: string): void;
}

interface SandboxMessage {
	type: 'boot' | 'ready' | 'result' | 'runtime-error';
	gen?: number;
	error?: string;
}

export function mountPreview(container: HTMLElement, host: PreviewHost = {}): Preview {
	const iframe = document.createElement('iframe');
	iframe.setAttribute('sandbox', SANDBOX_FLAGS);
	iframe.setAttribute('title', 'preview');
	// Absolutely positioned inside the relative .fill container: immune to
	// percentage-height quirks of flex items across engines.
	iframe.style.position = 'absolute';
	iframe.style.inset = '0';
	iframe.style.width = '100%';
	iframe.style.height = '100%';
	iframe.style.border = '0';

	// Every preview failure surfaces HERE, in the pane itself — never only
	// in a console. A blank preview must always explain itself.
	const errorBanner = document.createElement('pre');
	errorBanner.style.position = 'absolute';
	errorBanner.style.inset = '0';
	errorBanner.style.margin = '0';
	errorBanner.style.padding = '8px';
	errorBanner.style.overflow = 'auto';
	errorBanner.style.whiteSpace = 'pre-wrap';
	errorBanner.style.font = '12px ui-monospace, monospace';
	errorBanner.style.color = '#b91c1c';
	errorBanner.style.background = '#fef2f2';
	errorBanner.style.display = 'none';
	errorBanner.setAttribute('role', 'alert');

	const showError = (message: string) => {
		errorBanner.textContent = `Preview error\n\n${message}`;
		errorBanner.style.display = 'block';
	};
	const clearError = () => {
		errorBanner.style.display = 'none';
	};

	let generation = 0;
	let booted = false;
	let bootError: string | null = null;
	let resolveRun: ((result: { error: string | null }) => void) | null = null;

	const onMessage = (event: MessageEvent<SandboxMessage>) => {
		if (event.source !== iframe.contentWindow) return;
		const message = event.data;
		switch (message.type) {
			case 'boot': {
				void fetch('/playground-runtime.json')
					.then((response) => response.json() as Promise<{ code: string }>)
					.then(
						(manifest) => iframe.contentWindow?.postMessage({ type: 'init', code: manifest.code }, '*'),
						(error) => {
							bootError = `runtime manifest unavailable (${String(error)})`;
							booted = true;
						},
					);
				break;
			}
			case 'ready': {
				if (message.error) bootError = `runtime failed to load: ${message.error}`;
				booted = true;
				break;
			}
			case 'result': {
				if (message.gen !== generation || !resolveRun) return;
				const settle = resolveRun;
				resolveRun = null;
				settle({ error: message.error ?? null });
				break;
			}
			case 'runtime-error': {
				if (message.gen !== generation) return;
				showError(`Runtime error\n\n${message.error ?? 'unknown runtime error'}`);
				host.onRuntimeError?.(message.error ?? 'unknown runtime error');
				break;
			}
		}
	};

	window.addEventListener('message', onMessage);
	container.appendChild(iframe);
	container.appendChild(errorBanner);
	iframe.srcdoc = SANDBOX_HTML;
	setTimeout(() => {
		if (!booted) {
			bootError = 'sandbox did not boot (no message from the preview iframe)';
			booted = true;
		}
	}, BOOT_TIMEOUT_MS);

	return {
		async run(graph) {
			const deadline = Date.now() + BOOT_TIMEOUT_MS;
			while (!booted && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			if (bootError) {
				showError(bootError);
				return { error: bootError };
			}
			const gen = ++generation;
			resolveRun?.({ error: null }); // superseded quietly
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					resolveRun = null;
					const timeoutError = `the preview did not report a result within ${RUN_TIMEOUT_MS / 1000}s`;
					resolve({ error: timeoutError });
				}, RUN_TIMEOUT_MS);
				resolveRun = (result) => {
					clearTimeout(timer);
					resolve(result);
				};
				iframe.contentWindow?.postMessage({ type: 'run', gen, ...graph }, '*');
			});
		},
		reportError(message: string) {
			showError(message);
		},
		destroy() {
			window.removeEventListener('message', onMessage);
			iframe.remove();
			errorBanner.remove();
		},
	};
}
