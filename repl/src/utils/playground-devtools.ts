// The devtools relay: the REAL Chrome DevTools UI (chii's build of the
// devtools frontend, loaded from the CDN) runs in a SECOND iframe inside the
// collapsible panel under the preview (the host). The preview iframe runs
// chobitsu — the Chrome DevTools protocol implemented in-page (see
// playground-sandbox.ts) — and this helper relays raw CDP message strings
// between the two frames over postMessage: preview → frontend responses,
// frontend → preview requests (wrapped in the protocol's `devtools` message).
// Messages are plain objects; CDP strings are the only strings in play, so
// the relay tells them apart by type alone (no marker key — same stance as
// solid-playground). The boot sequence is parent-driven so no CDP message can
// race the frontend's load.

/** The relay's parent-side surface, owned by createPreview (see playground.ts). */
export interface DevtoolsRelay {
	/**
	 * Lazily create the devtools frontend iframe (the real Chrome DevTools UI
	 * served from the chii CDN build) into the devtools host and start the
	 * CDP relay to the sandbox's chobitsu. No-op once created.
	 */
	ensure(): void;
	/**
	 * The frontend reads its theme from the parent's `localStorage` (the
	 * iframe document is a blob: URL sharing the parent's origin) and cannot
	 * observe the parent, so after the parent flips `uiTheme` the frontend is
	 * reloaded — and re-booted (a fresh document has no page state). Always
	 * writes the key so a lazily-created frontend boots in the right theme.
	 */
	onThemeChanged(theme: 'light' | 'dark'): void;
	destroy(): void;
}

export interface DevtoolsRelayOptions {
	/** Where the devtools iframe is mounted (the collapsible panel host). */
	host: Element | null | undefined;
	/** The preview iframe — its load event gates the boot handshake. */
	preview: HTMLIFrameElement | null;
	/** The srcdoc the Sources panel shows for the sandbox frame. */
	pageSource: string;
	/** Send a protocol message to the sandbox. */
	send: (msg: Record<string, unknown>) => void;
	win: Window;
	doc: Document;
}

// The devtools frontend is the REAL Chrome DevTools UI, built by chii from
// the upstream devtools-frontend with a postMessage transport (the parent
// relays instead of a WebSocket backend). Loaded from the CDN so the parent
// page's bundle stays lean; pinned exactly as solid-playground does.
const CHII_FRONTEND_URL =
	'https://cdn.jsdelivr.net/npm/chii@1.15.5/public/front_end/entrypoints/chii_app/chii_app.js';
const CHII_REQUEST_IDLE_CALLBACK_URL =
	'https://cdn.jsdelivr.net/npm/chii@1.15.5/public/front_end/third_party/polyfill/requestIdleCallback.js';
const UNGAP_CUSTOM_ELEMENTS_URL = 'https://unpkg.com/@ungap/custom-elements/es.js';

// The devtools iframe document. `#?embedded=<origin>` tells chii's frontend
// to speak CDP over postMessage to its parent (which relays here); the
// polyfills mirror chii's own embedded-mode bootstrap. The trailing script
// best-effort docks the Console panel once the frontend boots (the same
// viewManager API puppeteer uses; harmless if the build hides it).
function devtoolsDocument(): string {
	return `<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8">
<title>DevTools</title>
<style>
	@media (prefers-color-scheme: dark) {
		body { background-color: rgb(41 42 45); }
	}
</style>
<meta name="referrer" content="no-referrer">
<script>
	const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
	if (isSafari) {
		document.write('<scr' + 'ipt src="${UNGAP_CUSTOM_ELEMENTS_URL}"></scr' + 'ipt>');
	}
	if (!window.requestIdleCallback) {
		document.write('<scr' + 'ipt src="${CHII_REQUEST_IDLE_CALLBACK_URL}"></scr' + 'ipt>');
	}
</script>
<script type="module" src="${CHII_FRONTEND_URL}"></script>
<script>
	(() => {
		const showConsole = () => {
			try {
				if (window.UI?.viewManager) {
					window.UI.viewManager.showView('console');
					return;
				}
			} catch (e) {}
			setTimeout(showConsole, 250);
		};
		setTimeout(showConsole, 250);
	})();
</script>
<body class="undocked" id="-blink-dev-tools">`;
}

export function createDevtoolsRelay(options: DevtoolsRelayOptions): DevtoolsRelay {
	const { host, preview, pageSource, send, win, doc } = options;
	let destroyed = false;

	// The devtools iframe is created lazily (first open) — the frontend is a
	// multi-MB CDN download. The boot handshake is parent-driven: only when
	// BOTH frames have loaded does the sandbox run its CDP boot sequence, so
	// no frontend-bound message can be lost to an unloaded listener.
	let devtoolsFrame: HTMLIFrameElement | null = null;
	let devtoolsUrl: string | null = null;
	let previewLoaded = false;
	let devtoolsLoaded = false;
	let devtoolsBootSent = false;
	const maybeBoot = () => {
		if (previewLoaded && devtoolsLoaded && !devtoolsBootSent) {
			devtoolsBootSent = true;
			send({ type: 'devtools-boot', pageSource });
		}
	};

	// Raw CDP strings from the sandbox go to the devtools frontend; raw
	// strings from the frontend go back as protocol `devtools` messages. Both
	// directions verify `event.source` (the relay's only guard — same shape
	// as solid-playground).
	const onRelayMessage = (event: MessageEvent) => {
		if (destroyed) return;
		if (event.source === preview?.contentWindow && typeof event.data === 'string') {
			devtoolsFrame?.contentWindow?.postMessage(event.data, '*');
			return;
		}
		if (
			devtoolsFrame &&
			event.source === devtoolsFrame.contentWindow &&
			typeof event.data === 'string'
		) {
			send({ type: 'devtools', data: event.data });
		}
	};
	win.addEventListener('message', onRelayMessage);

	preview?.addEventListener('load', () => {
		previewLoaded = true;
		maybeBoot();
	});

	return {
		ensure() {
			if (destroyed || devtoolsFrame || !host) return;
			const url = URL.createObjectURL(new Blob([devtoolsDocument()], { type: 'text/html' }));
			devtoolsUrl = url;
			const frame = doc.createElement('iframe');
			frame.setAttribute('title', 'Playground devtools');
			frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
			frame.addEventListener('load', () => {
				devtoolsLoaded = true;
				maybeBoot();
			});
			// `#?embedded=<origin>` switches chii's frontend onto its postMessage
			// transport — the only channel the sandbox boundary permits.
			frame.src = `${url}#?embedded=${encodeURIComponent(win.location.origin)}`;
			host.appendChild(frame);
			devtoolsFrame = frame;
		},
		onThemeChanged(theme) {
			try {
				win.localStorage.setItem('uiTheme', theme === 'light' ? '"default"' : '"dark"');
			} catch {
				// Storage unavailable — the frontend keeps its previous theme.
			}
			if (!devtoolsFrame) return;
			devtoolsBootSent = false;
			devtoolsFrame.contentWindow?.location.reload();
		},
		destroy() {
			destroyed = true;
			win.removeEventListener('message', onRelayMessage);
			devtoolsFrame?.remove();
			if (devtoolsUrl) URL.revokeObjectURL(devtoolsUrl);
		},
	};
}