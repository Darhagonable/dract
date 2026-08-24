// Playground engine — compiles and executes TSRX/TS/TSX in the browser.
//
// Compilation now happens through the Project (see playground-modules.ts):
// it owns the cross-file graph, so imported state stays a signal across module
// boundaries, and it is pure JS/WASM (oxc-parser + oxc-transform wasm bindings
// + esrap printer, no Node APIs). This module keeps the EXECUTION side: the
// compiled modules RUN inside a sandboxed iframe with an opaque origin (see
// playground-sandbox.ts) — never in the website's own page. Hash-shared
// playground links carry arbitrary code, so the page it runs in must have no
// same-origin storage, cookies, or DOM to steal. The parent fetches the dartsx
// runtime chunk manifest (served by the playgroundRuntime() vite plugin) and
// hands it to the iframe, which builds blob modules on its own side of the
// boundary. Multi-file graphs and third-party esm.sh imports are prepared by
// playground-modules.ts.
//
// DevTools: the REAL Chrome DevTools UI runs in a SECOND iframe inside the
// collapsible panel under the preview; the CDP relay, frontend document, and
// boot handshake live in playground-devtools.ts. The preview iframe runs
// chobitsu — the Chrome DevTools protocol implemented in-page (see
// playground-sandbox.ts). Messages are plain objects; CDP strings are the
// only strings in play, so both sides tell them apart by type alone (no
// marker key — same stance as solid-playground).
//
// Client-only: load via dynamic import from an effect (never during SSR).
import { sandboxSrcdoc, type RuntimeManifest } from './playground-sandbox.ts';
import { createDevtoolsRelay, type DevtoolsRelay } from './playground-devtools.ts';
import runtimeManifest from 'virtual:dartsx-runtime-manifest';

export type PlaygroundLang = 'tsx';
export type PlaygroundRuntimeTarget = 'client' | 'server';
// Which compiler artifact the compiled pane shows. Server and Types are
// placeholders for now: DarTsx currently compiles one client runtime, and the
// targets are kept so future emits (a server renderer, .d.ts output) land in
// the same pane.
export type PlaygroundOutputTarget = PlaygroundRuntimeTarget | 'types';

// ── Sandboxed execution ─────────────────────────────────────────────────────

/** The subset of a built module graph the sandbox needs to execute a run. */
export interface RunPayload {
	entry: string;
	modules: { name: string; code: string }[];
}

export interface Preview {
	/** Execute a compiled playground module graph and render its entry component. Never throws. */
	run(payload: RunPayload): Promise<{ error: string | null }>;
	/**
	 * Lazily create the devtools frontend iframe (the real Chrome DevTools UI
	 * served from the chii CDN build) into the devtools host and start the
	 * CDP relay to the sandbox's chobitsu. No-op once created.
	 */
	ensureDevtools(): void;
	destroy(): void;
}

export const PREVIEW_READY_TIMEOUT_MS = 10_000;
export const PREVIEW_RUN_TIMEOUT_MS = 10_000;

/**
 * A live preview bound to `container` — creates the sandboxed iframe and
 * drives the postMessage protocol (see playground-sandbox.ts for the boundary
 * design). `onRuntimeError` reports errors thrown AFTER the initial render
 * resolves (effects, event handlers — caught by the error boundary the sandbox
 * wraps around the user component). `devtoolsHost` (optional) receives the
 * devtools frontend iframe on the first `ensureDevtools()` call.
 */
export function createPreview(
	container: Element,
	onRuntimeError: (message: string) => void,
	devtoolsHost?: Element | null,
): Preview {
	const doc = container.ownerDocument;
	const win = doc.defaultView!;
	const currentTheme = (): 'light' | 'dark' =>
		doc.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

	// One srcdoc serves as the page's canonical source too: the devtools
	// Sources panel can't fetch an about:srcdoc document, so the sandbox
	// serves this exact string for the frame's content.
	const sandboxDoc = sandboxSrcdoc(currentTheme());

	const iframe = doc.createElement('iframe');
	// Opaque-origin sandbox (NO allow-same-origin): no cookies, storage, or
	// parent DOM — the boundary for arbitrary hash-shared code. The extra
	// allow-* tokens match solid-playground: user code gets popups, modals,
	// pointer lock, and form-submit events (a real submission only navigates
	// the sandboxed frame itself).
	iframe.setAttribute(
		'sandbox',
		'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-pointer-lock',
	);
	iframe.setAttribute('title', 'Playground preview');
	iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
	iframe.srcdoc = sandboxDoc;
	container.appendChild(iframe);
	const frameWindow = iframe.contentWindow;

	let destroyed = false;
	let generation = 0;
	const pending = new Map<
		number,
		{
			resolve: (result: { error: string | null }) => void;
			timeout: number;
		}
	>();
	const send = (msg: Record<string, unknown>) => {
		frameWindow?.postMessage(msg, '*');
	};
	// The devtools relay owns the frontend iframe, the CDP relay, and the
	// parent-driven boot handshake (see playground-devtools.ts); `send` feeds
	// it the sandbox-bound protocol messages.
	const devtoolsRelay: DevtoolsRelay = createDevtoolsRelay({
		host: devtoolsHost,
		preview: iframe,
		pageSource: sandboxDoc,
		send,
		win,
		doc,
	});
	const settlePending = (gen: number, result: { error: string | null }) => {
		const entry = pending.get(gen);
		if (!entry) return;
		pending.delete(gen);
		win.clearTimeout(entry.timeout);
		entry.resolve(result);
	};

	// Resolves once the sandbox has imported the runtime bundle; resolves with
	// an actionable error string when the iframe is unavailable, fails to boot,
	// or boots but never acknowledges the runtime bundle.
	let cleanupListener: (() => void) | undefined;
	let settleReady: (error: string | null) => void = () => {};
	const ready = frameWindow
		? new Promise<string | null>((resolve) => {
				let settled = false;
				let bootReceived = false;
				const readyTimeout = win.setTimeout(() => {
					settleReady(
						bootReceived
							? 'Preview sandbox booted but did not become ready before the timeout.'
							: 'Preview sandbox did not boot before the timeout (iframe scripts may be unavailable).',
					);
				}, PREVIEW_READY_TIMEOUT_MS);
				settleReady = (error) => {
					if (settled) return;
					settled = true;
					win.clearTimeout(readyTimeout);
					resolve(error);
				};
				const onMessage = (event: MessageEvent) => {
					if (destroyed || event.source !== frameWindow) return;
					const msg = event.data;
					// Protocol messages are objects; raw CDP strings (the devtools
					// relay) pass by on the way to the devtools iframe.
					if (!msg || typeof msg !== 'object') return;
					switch (msg.type) {
						case 'boot':
							bootReceived = true;
							// The srcdoc carried the theme at creation time; re-send it in
							// case the toggle flipped before the sandbox started listening.
							send({ type: 'theme', theme: currentTheme() });
							// Sandbox is listening — hand it the runtime chunk manifest (it
							// cannot fetch same-origin resources itself; see sandbox notes).
							// Synthesized by playgroundRuntime() in vite.config.ts from
							// dartsx's built dist output.
							send({ type: 'init', manifest: runtimeManifest });
							break;
						case 'ready':
							settleReady(typeof msg.error === 'string' ? msg.error : null);
							break;
						case 'result': {
							settlePending(msg.gen, { error: typeof msg.error === 'string' ? msg.error : null });
							break;
						}
						case 'runtime-error':
							// Only the CURRENT run's errors reach the banner — a late
							// error from a superseded run (a timer firing after a
							// recompile) must not stick over the newer run's clean render.
							if (msg.gen === generation && typeof msg.error === 'string') {
								onRuntimeError(msg.error);
							}
							break;
					}
				};
				win.addEventListener('message', onMessage);
				cleanupListener = () => {
					win.removeEventListener('message', onMessage);
				};
			})
		: Promise.resolve('Preview iframe is unavailable in this browser environment.');

	// Keep the sandbox's theme in sync with the site's ThemeToggle (it flips
	// `data-theme` on <html>; an opaque-origin iframe can't observe the parent).
	// The devtools frontend follows through the relay (see onThemeChanged).
	let themeObserver: MutationObserver | null = null;
	if (typeof win.MutationObserver === 'function') {
		themeObserver = new win.MutationObserver(() => {
			send({ type: 'theme', theme: currentTheme() });
			devtoolsRelay.onThemeChanged(currentTheme());
		});
		themeObserver.observe(doc.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});
	}

	return {
		async run(payload) {
			const gen = ++generation;
			const readyError = await ready;
			if (destroyed || gen !== generation) return { error: null }; // superseded
			if (readyError) return { error: readyError };

			// A newer run supersedes any still-pending one — resolve it quietly so
			// the caller's error handling never fires for stale results.
			for (const staleGen of pending.keys()) {
				settlePending(staleGen, { error: null });
			}
			return new Promise((resolve) => {
				const timeout = win.setTimeout(() => {
					settlePending(gen, {
						error: 'Preview sandbox did not return a render result before the timeout.',
					});
				}, PREVIEW_RUN_TIMEOUT_MS);
				pending.set(gen, { resolve, timeout });
				send({
					type: 'run',
					gen,
					entry: payload.entry,
					modules: payload.modules,
				});
			});
		},
		ensureDevtools() {
			devtoolsRelay.ensure();
		},
		destroy() {
			destroyed = true;
			settleReady(null);
			themeObserver?.disconnect();
			cleanupListener?.();
			for (const gen of pending.keys()) settlePending(gen, { error: null });
			iframe.remove();
			devtoolsRelay.destroy();
		},
	};
}
