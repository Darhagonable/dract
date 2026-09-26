// The playground preview's SECURITY BOUNDARY. User code from the editor (and,
// critically, from shareable `location.hash` payloads) executes inside an
// `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox
// allow-forms allow-modals allow-pointer-lock">` built from this srcdoc — an
// OPAQUE origin with no access to the website's window, DOM, cookies, or
// storage, and no CSP of its own (same stance as solid-playground: the code
// gets website-level capabilities — fetch, popups, external scripts — but
// never same-origin privileges; the parent page is untouchable either way).
// The consent gate for hash-shared links is unchanged, and compilation is pure
// string work in the parent, so no esm.sh traffic can happen before the user
// consents to running shared code. The parent page never imports user modules
// itself.
//
// Module plumbing: an opaque-origin iframe cannot use the parent's blob: URLs
// (blob resolution is same-origin) and cross-origin module fetches would need
// CORS, so the runtime and user modules arrive as TEXT over postMessage and
// become blob modules INSIDE the iframe:
//
//   parent → iframe  { type: 'init', manifest }  dartsx runtime chunk manifest
//                                                (the entries/order/files JSON
//                                                the vite plugin serves at
//                                                RUNTIME_MANIFEST_PATH), once
//   parent → iframe  { type: 'run', gen, entry, entryKind, modules }
//                                                compiled user module graph in
//                                                dependency order
//   parent → iframe  { type: 'theme', theme }    'light' | 'dark' — keeps the
//                                                preview canvas aligned with
//                                                the site's ThemeToggle
//   parent → iframe  { type: 'devtools', data }  raw CDP message string from
//                                                the devtools frontend
//   parent → iframe  { type: 'devtools-boot', pageSource }
//                                                frontend iframe loaded — run
//                                                the CDP boot sequence; the
//                                                srcdoc is what the Sources
//                                                panel shows for the frame
//   iframe → parent  { type: 'boot' }            bootstrap script is listening
//   iframe → parent  { type: 'ready', error? }   runtime imported (or failed)
//   iframe → parent  { type: 'result', gen, error }
//   iframe → parent  { type: 'runtime-error', gen, error }  post-render — from
//                                                uncaught errors in event
//                                                handlers / effects; gen lets
//                                                the parent drop late errors
//                                                from a superseded run
//
// DevTools: chobitsu (the Chrome DevTools protocol implemented in-page — see
// playground.ts for the parent half) runs inside the sandbox and mirrors the
// page to the REAL Chrome DevTools frontend, which the parent hosts in a
// sibling iframe. The two speak raw CDP message STRINGS over the parent's
// relay (strings, so the parent's protocol handling ignores them — protocol
// messages are objects). Before chobitsu loads, a shim makes the opaque
// origin bearable: storage access throws there (in-memory stand-ins) and
// chobitsu's URL fallback reads `parent.location` across the boundary (a fake
// `window.parent` exposing only location + a forwarding postMessage). Like
// solid-playground, neither side verifies `event.source` — only the parent
// page can postMessage into the iframe, and the relay checks sources itself.
//
// Import resolution inside the iframe: the bootstrap blob-ifies the runtime
// chunks dependencies-first, then installs a SINGLE import map — as a classic
// (non-module) script it runs before any module load, which is baseline
// import-map behavior in every supporting browser; no late-map mutation
// anywhere — wiring bare `dartsx` / `dartsx/internal/client` to those blobs
// and the react family to esm.sh (react is only fetched if something imports
// it). User modules keep those specifiers bare; sibling-file imports arrive as
// `__pg_module:<name>__` tokens the bootstrap swaps for blob URLs.
//
// `allow-forms` lets `<form action={fn}>` demos fire submit events; a real
// submission navigates only the sandboxed frame itself (opaque origin), same
// as solid-playground.

/** Where the runtime chunk manifest JSON is served/emitted. */
export const RUNTIME_MANIFEST_PATH = '/playground-runtime.json';

/**
 * React version pinned into the sandbox import map. Keep aligned with the
 * workspace catalog's `react: ^19.2.0` pin — every map entry uses the SAME
 * version so esm.sh dedupes react/react-dom onto one internal build (the
 * React-host host and user code must share a react singleton).
 */
export const PLAYGROUND_REACT_VERSION = '19.2.0';

/** Shape of the runtime manifest built by the playgroundRuntime() vite plugin. */
export interface RuntimeManifest {
	entries: { dartsx: string; 'dartsx/internal/client': string };
	order: string[];
	files: Record<string, string>;
}

/** Wraps a sibling-file module name into its rewritten-specifier token. */
export function moduleToken(name: string): string {
	return `__pg_module:${name}__`;
}

// The devtools FRONTEND is the real Chrome DevTools UI, loaded by the parent
// from the chii CDN build (see playground.ts). Its in-page backend, chobitsu,
// loads here from the same CDN pin solid-playground uses — the srcdoc has no
// CSP, so no vendoring is needed.
const CHOBITSU_URL = 'https://cdn.jsdelivr.net/npm/chobitsu@1.8.6/dist/chobitsu.min.js';

// Runs BEFORE chobitsu (and the bootstrap). The opaque-origin sandbox has no
// usable localStorage/sessionStorage (access throws), and chobitsu's URL
// fallback reads `parent.location` across the boundary — both must be shimmed
// for its Resources/Sources panels (the same shim solid-playground runs).
const SANDBOX_SHIM = `
(() => {
	const make = () => {
		const m = new Map();
		return {
			getItem: (k) => (m.has(k) ? m.get(k) : null),
			setItem: (k, v) => { m.set(k, String(v)); },
			removeItem: (k) => { m.delete(k); },
			clear: () => { m.clear(); },
			key: (i) => Array.from(m.keys())[i] ?? null,
			get length() { return m.size; },
		};
	};
	Object.defineProperty(window, 'localStorage', { value: make(), configurable: true });
	Object.defineProperty(window, 'sessionStorage', { value: make(), configurable: true });
	const realParent = window.parent;
	window.parent = {
		location: { href: location.href, origin: location.origin || 'about:srcdoc' },
		postMessage: (msg, target, transfer) => realParent.postMessage(msg, target, transfer),
	};
})();
`;

// Kept as a plain string (not a function that's stringified) so esbuild/terser
// renaming can't corrupt it, and indented for readability in devtools. This is
// a CLASSIC script (dynamic import() only) so the import map it writes is
// guaranteed to precede the first module load.
const BOOTSTRAP = `
const REACT_VERSION = ${JSON.stringify(PLAYGROUND_REACT_VERSION)};
const TOKEN = /__pg_module:([\\w.-]+)__/g;
const post = (msg) => window.parent.postMessage(msg, '*');
const errText = (e) => (e instanceof Error && e.message) || String(e);
const toBlobUrl = (code) =>
	URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));

// ── DevTools (chobitsu ↔ chii frontend) ──────────────────────────────────
// chobitsu (loaded above in the srcdoc) implements the Chrome DevTools
// protocol for THIS document; the real DevTools frontend lives in a sibling
// iframe in the parent and relays raw CDP message strings through it. Like
// solid-playground, only the parent can postMessage into this frame, so the
// messages are trusted as-is and dispatched on content alone.
const postRaw = (message) => window.parent.postMessage(message, '*');
let chobitsuId = 0;
// chii stamps the messages it synthesizes with 'tmp' ids so its own response
// filter can distinguish them; responses to THOSE must not reach the frontend
// (it never saw the request).
const sendToChobitsu = (message) => {
	message.id = 'tmp' + ++chobitsuId;
	chobitsu.sendRawMessage(JSON.stringify(message));
};
chobitsu.setOnMessage((message) => {
	if (message.includes('"id":"tmp')) return;
	postRaw(message);
});
// What the frontend's Sources panel shows for the frame — the parent sends the
// srcdoc itself with the boot message (the page cannot be fetched, it is
// about:srcdoc).
let pageSource = '';
const pageDomain = chobitsu.domain('Page');
if (pageDomain) {
	pageDomain.getResourceContent = (params) =>
		Promise.resolve({ base64Encoded: false, content: params.frameId === '1' ? pageSource : '' });
}

let dartsxRuntime = null;
let generation = 0;
let liveUrls = []; // current run's module blob URLs — kept alive so lazy
                   // dynamic import('./sibling') still resolves after render

const teardown = () => {
	document.getElementById('root').innerHTML = '';
};

const findComponent = (mod) => {
	if (typeof mod.default === 'function') return mod.default;
	if (typeof mod.App === 'function') return mod.App;
	for (const key of Object.keys(mod)) {
		if (typeof mod[key] === 'function') return mod[key];
	}
	return null;
};

// Errors that escape event handlers / effects surface to the parent as
// runtime errors (there is no dartsx error boundary to catch them in-tree).
window.addEventListener('error', (event) => {
	post({ type: 'runtime-error', gen: generation, error: errText(event.error ?? event.message) });
});

window.addEventListener('message', async (event) => {
	const msg = event.data;
	if (!msg || typeof msg !== 'object') return;

	if (msg.type === 'devtools' && typeof msg.data === 'string') {
		chobitsu.sendRawMessage(msg.data);
		return;
	}

	if (msg.type === 'devtools-boot') {
		// The frontend iframe has loaded (parent-driven so no boot message is
		// lost racing the frontend's initial load — see playground.ts).
		if (typeof msg.pageSource === 'string') pageSource = msg.pageSource;
		const frame = {
			id: '1',
			mimeType: 'text/html',
			securityOrigin: parent.location.origin,
			url: parent.location.href,
		};
		postRaw(JSON.stringify({ method: 'Page.frameNavigated', params: { frame, type: 'Navigation' } }));
		sendToChobitsu({ method: 'Network.enable' });
		postRaw(JSON.stringify({ method: 'Runtime.executionContextsCleared' }));
		sendToChobitsu({ method: 'Runtime.enable' });
		sendToChobitsu({ method: 'Debugger.enable' });
		sendToChobitsu({ method: 'DOMStorage.enable' });
		sendToChobitsu({ method: 'DOM.enable' });
		sendToChobitsu({ method: 'CSS.enable' });
		sendToChobitsu({ method: 'Overlay.enable' });
		postRaw(JSON.stringify({ method: 'DOM.documentUpdated' }));
		sendToChobitsu({ method: 'Page.enable' });
		postRaw(JSON.stringify({ method: 'Page.loadEventFired' }));
		return;
	}

	if (msg.type === 'theme') {
		if (msg.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
		else if (msg.theme === 'dark') document.documentElement.removeAttribute('data-theme');
		return;
	}

	if (msg.type === 'init' && !dartsxRuntime && msg.manifest) {
		try {
			const { entries, order, files } = msg.manifest;
			// Blob-ify the runtime chunks dependencies-first, splicing each file's
			// "./name.mjs" specifiers to the already-created blob URLs.
			const blobs = Object.create(null);
			for (const name of order) {
				const code = files[name].replace(/(["'])\\.\\/([\\w.-]+\\.mjs)\\1/g, (m, _q, dep) =>
					blobs[dep] ? JSON.stringify(blobs[dep]) : m,
				);
				blobs[name] = toBlobUrl(code);
			}
			// Install the import map BEFORE the first module load (see header).
			const esm = (path) => 'https://esm.sh/' + path;
			const map = document.createElement('script');
			map.type = 'importmap';
			map.textContent = JSON.stringify({
				imports: {
					dartsx: blobs[entries['dartsx']],
					'dartsx/internal/client': blobs[entries['dartsx/internal/client']],
					react: esm('react@' + REACT_VERSION),
					'react/jsx-runtime': esm('react@' + REACT_VERSION + '/jsx-runtime'),
					'react/jsx-dev-runtime': esm('react@' + REACT_VERSION + '/jsx-dev-runtime'),
					'react-dom': esm('react-dom@' + REACT_VERSION),
					'react-dom/client': esm('react-dom@' + REACT_VERSION + '/client'),
				},
			});
			document.head.appendChild(map);
			dartsxRuntime = await import('dartsx');
			post({ type: 'ready' });
		} catch (e) {
			post({ type: 'ready', error: errText(e) });
		}
		return;
	}

	if (msg.type === 'run' && dartsxRuntime && Array.isArray(msg.modules)) {
		const gen = ++generation;
		// Blob-ify the user module graph (arrives dependencies-first), swapping
		// sibling-file tokens for the blob URLs created so far.
		// The PREVIOUS run's URLs can be revoked now; this run's stay alive.
		document.getElementById('appsrc')?.remove();
		for (const url of liveUrls) URL.revokeObjectURL(url);
		const moduleUrls = Object.create(null);
		const created = [];
		liveUrls = created;
		let entryUrl = null;
		for (const { name, code } of msg.modules) {
			const resolved = code.replace(TOKEN, (m, dep) => moduleUrls[dep] ?? m);
			const url = toBlobUrl(resolved);
			moduleUrls[name] = url;
			created.push(url);
			if (name === msg.entry) entryUrl = url;
		}
		// Mirror solid-playground's DOM: the entry is attached as a real
		// #appsrc module script (visible in the devtools Elements tree). The
		// dynamic import below joins the SAME module-map entry, so the element
		// does not double-execute — and the import keeps the exports reachable
		// for findComponent/mounting.
		if (entryUrl) {
			const script = document.createElement('script');
			script.id = 'appsrc';
			script.type = 'module';
			script.src = entryUrl;
			document.body.appendChild(script);
		}
		let mod;
		try {
			mod = await import(entryUrl);
		} catch (e) {
			let error = errText(e);
			if (msg.modules.some(({ code }) => code.includes('https://esm.sh/'))) {
				error =
					'Failed to load the module graph — if the error below points at an ' +
					'esm.sh module, the package/version may not exist or the network ' +
					'may be unreachable: ' + error;
			}
			post({ type: 'result', gen: msg.gen, error });
			return;
		}
		if (gen !== generation) return; // superseded by a newer run

		const component = findComponent(mod);
		if (!component) {
			post({
				type: 'result',
				gen: msg.gen,
				error: 'Export a component to render — e.g. "export default component App() { … }".',
			});
			return;
		}
		teardown();
		const rootEl = document.getElementById('root');
		try {
			if (msg.entryKind === 'react') {
				// React-host entry (.react.tsx files): mount with the REAL
				// react-dom from esm.sh.
				const [React, ReactDOMClient] = await Promise.all([
					import('react'),
					import('react-dom/client'),
				]);
				if (gen !== generation) return;
				const reactRoot = ReactDOMClient.createRoot(rootEl, {
					onUncaughtError: (error) =>
						post({ type: 'runtime-error', gen: msg.gen, error: errText(error) }),
					onCaughtError: (error) =>
						post({ type: 'runtime-error', gen: msg.gen, error: errText(error) }),
				});
				reactRoot.render(React.createElement(component));
			} else {
				dartsxRuntime.mount(component, rootEl);
			}
		} catch (e) {
			teardown();
			post({ type: 'result', gen: msg.gen, error: errText(e) });
			return;
		}
		post({ type: 'result', gen: msg.gen, error: null });
	}
});

post({ type: 'boot' });
`;

/**
 * The full srcdoc for the preview iframe. No CSP (solid-playground stance):
 * the sandbox's opaque origin is the security boundary; the document gets
 * ordinary website-level capabilities (fetch, popups, external scripts) but
 * never same-origin privileges.
 *
 * `theme` sets the initial canvas; later flips arrive as `theme` protocol
 * messages (the bootstrap toggles `data-theme` on the sandbox's own root).
 *
 * Script order matters: the storage/parent shim must precede chobitsu (it
 * reads both at init), and chobitsu precedes the bootstrap so the CDP relay
 * is ready before the first protocol message. All three live in <head> (like
 * solid-playground) so the devtools Elements tree shows a clean body: just
 * the preview's `#root`, plus the entry `#appsrc` module script appended at
 * run time; none of the head scripts touch the body at parse time (the
 * bootstrap only reads `#root` when a `run` message arrives, after parse).
 */
export function sandboxSrcdoc(theme: 'dark' | 'light' = 'dark'): string {
	return `<!doctype html>
<html${theme === 'light' ? ' data-theme="light"' : ''}>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="https://ga.jspm.io/npm:modern-normalize@3.0.1/modern-normalize.css" rel="stylesheet" />
<style>
	:root { color-scheme: dark; }
	:root[data-theme='light'] { color-scheme: light; }
	body {
		margin: 0;
		padding: 1.25rem;
		background: #16181d;
		color: #f4eee8;
		font-family: system-ui, sans-serif;
	}
	:root[data-theme='light'] body {
		background: #ffffff;
		color: #1c2027;
	}
	/* chobitsu's viewport-size-on-resize badge (top-right, 1s after a resize):
	   inline white background, no inline color — its text falls back to the
	   initial CanvasText, which color-scheme: dark renders near-white. Pin a
	   dark color so it stays readable in both themes. (The only other
	   __chobitsu-hide__ node, the highlighter host, is all:initial + shadow
	   DOM, so this rule can't touch element highlighting.) */
	.__chobitsu-hide__ { color: #1c2027; }
</style>
<script>${SANDBOX_SHIM}</script>
<script src="${CHOBITSU_URL}"></script>
<script>${BOOTSTRAP}</script>
</head>
<body>
<div id="root"></div>
</body>
</html>`;
}
