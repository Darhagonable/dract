// Shared-link serialization: encode/decode the workspace into a
// `location.hash` payload, with strict input bounds — a hash is UNTRUSTED
// input. Decoding happens before the editor/highlighter stack loads; decoded
// source is safe to display and compile (pure string work) but never executes
// until the visitor consents (see ConsentOverlay / kernel commands).
import type { PlaygroundLang, PlaygroundFile } from './types.ts';
import { TSCONFIG_FILE_NAME } from './types.ts';

/** Total source budget across ALL files in a workspace. */
export const MAX_PLAYGROUND_SOURCE_LENGTH = 20_000;

export const MAX_PLAYGROUND_FILES = 10;

// JSON can escape one UTF-16 code unit as six ASCII bytes (`\u0000`), then
// base64 expands by 4/3. Bound the encoded input before `atob` so a hostile URL
// cannot force an unbounded allocation merely by opening the playground. The
// constant term covers the v2 envelope and per-file name/JSON overhead.
export const MAX_PLAYGROUND_HASH_LENGTH = Math.ceil(
	((MAX_PLAYGROUND_SOURCE_LENGTH * 6 + 2048) * 4) / 3,
);

export const PLAYGROUND_SOURCE_LIMIT_ERROR = `Source is limited to ${MAX_PLAYGROUND_SOURCE_LENGTH} characters in the playground.`;

// Single-extension source names only. The
// workspace tsconfig file is the one allowed non-source name (it is a config
// document, never a module).
// Single-extension source names only (.tsx/.ts — the bundler resolves
// sibling imports for both). The workspace tsconfig file is the one allowed
// non-source name (it is a config document, never a module).
const FILE_NAME_PATTERN = /^[A-Za-z0-9_-]+\.tsx?$/;
const isAcceptableFileName = (name: string) =>
	name === TSCONFIG_FILE_NAME || FILE_NAME_PATTERN.test(name);

export type PlaygroundHashPayload = {
	lang: PlaygroundLang;
	entry: string;
	files: PlaygroundFile[];
};
export type PlaygroundHashResult =
	{ ok: true; value: PlaygroundHashPayload | null } | { ok: false; error: string };

function totalLength(files: PlaygroundFile[]): number {
	return files.reduce((sum, file) => sum + file.source.length, 0);
}

/** Encode the active workspace as a v2 share hash ('' when over budget). */
export function encodePlaygroundHash(payload: PlaygroundHashPayload): string {
	if (totalLength(payload.files) > MAX_PLAYGROUND_SOURCE_LENGTH) return '';
	try {
		const json = JSON.stringify({
			v: 2,
			l: payload.lang,
			e: payload.entry,
			f: payload.files.map((file) => ({ n: file.name, s: file.source })),
		});
		const bytes = new TextEncoder().encode(json);
		let binary = '';
		for (let offset = 0; offset < bytes.length; offset += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
		}
		return btoa(binary);
	} catch {
		return '';
	}
}

/** Decode and validate a shared hash before the editor/highlighter stack loads. */
export function decodePlaygroundHash(hash: string): PlaygroundHashResult {
	if (!hash) return { ok: true, value: null };
	if (hash.length > MAX_PLAYGROUND_HASH_LENGTH) {
		return { ok: false, error: PLAYGROUND_SOURCE_LIMIT_ERROR };
	}

	try {
		const json = new TextDecoder().decode(
			Uint8Array.from(atob(hash), (character) => character.charCodeAt(0)),
		);
		const parsed = JSON.parse(json);

		if (parsed?.v === 2) {
			if (parsed.l !== 'tsx') return { ok: true, value: null };
			if (
				!Array.isArray(parsed.f) ||
				parsed.f.length < 1 ||
				parsed.f.length > MAX_PLAYGROUND_FILES
			) {
				return { ok: true, value: null };
			}
			const files: PlaygroundFile[] = [];
			const names = new Set<string>();
			for (const entry of parsed.f) {
				if (
					typeof entry?.n !== 'string' ||
					typeof entry?.s !== 'string' ||
					!isAcceptableFileName(entry.n) ||
					names.has(entry.n)
				) {
					return { ok: true, value: null };
				}
				names.add(entry.n);
				files.push({ name: entry.n, source: entry.s });
			}
			if (
				typeof parsed.e !== 'string' ||
				!names.has(parsed.e) ||
				parsed.e === TSCONFIG_FILE_NAME
			) {
				return { ok: true, value: null };
			}
			if (totalLength(files) > MAX_PLAYGROUND_SOURCE_LENGTH) {
				return { ok: false, error: PLAYGROUND_SOURCE_LIMIT_ERROR };
			}
			return { ok: true, value: { lang: parsed.l, entry: parsed.e, files } };
		}

		// Legacy single-file payloads (`{ s, l }`) keep working: normalize to a
		// one-file workspace named after the shared dialect.
		if (typeof parsed?.s !== 'string' || parsed?.l !== 'tsx') {
			return { ok: true, value: null };
		}
		if (parsed.s.length > MAX_PLAYGROUND_SOURCE_LENGTH) {
			return { ok: false, error: PLAYGROUND_SOURCE_LIMIT_ERROR };
		}
		const name = `App.${parsed.l}`;
		return {
			ok: true,
			value: { lang: parsed.l, entry: name, files: [{ name, source: parsed.s }] },
		};
	} catch {
		// A malformed unrelated fragment is not a playground payload.
		return { ok: true, value: null };
	}
}

// sessionStorage record of the last hash THIS tab wrote (plus the example it
// came from). A payload matching it is the visitor's own work surviving a
// reload or route remount — restored without the shared-code consent gate.
// sessionStorage is same-origin and per-tab, so a link someone sends can never
// pre-seed it.
const OWN_HASH_STORAGE_KEY = 'octane-playground-own-hash';

/**
 * Shared-link persistence policy: reading the current URL's payload,
 * recognizing this tab's own work, and writing the workspace back into the
 * URL. The caller decides WHEN (debounce, consent gating) — this owns HOW
 * (encoding, history, sessionStorage).
 */
export class ShareLink {
	/** Decode and validate the current URL hash (call once at boot). */
	decode(hash: string): PlaygroundHashResult {
		return decodePlaygroundHash(hash);
	}

	readCurrentHash(): string {
		return window.location.hash.slice(1);
	}

	/** This tab's own last-written hash + example, or null. */
	readOwn(): { hash: string; exampleId: string } | null {
		try {
			const stored = window.sessionStorage.getItem(OWN_HASH_STORAGE_KEY);
			if (!stored) return null;
			const parsed = JSON.parse(stored);
			return typeof parsed?.hash === 'string' && typeof parsed?.exampleId === 'string'
				? parsed
				: null;
		} catch {
			return null;
		}
	}

	/** Does `hash` match what THIS tab last wrote? */
	isOwnWork(hash: string): boolean {
		return this.readOwn()?.hash === hash;
	}

	/**
	 * Write the workspace into the URL (replaceState — only the hash on the
	 * current entry changes; the router observes it through its history
	 * wrapper without remounting the route) and remember it as this tab's own
	 * work so a reload doesn't re-gate it. No-op when over budget.
	 */
	publish(payload: PlaygroundHashPayload, exampleId: string): void {
		const encoded = encodePlaygroundHash(payload);
		if (!encoded) return;
		window.history.replaceState(null, '', '#' + encoded);
		try {
			window.sessionStorage.setItem(
				OWN_HASH_STORAGE_KEY,
				JSON.stringify({ hash: encoded, exampleId }),
			);
		} catch {
			// Storage full/unavailable — sharing still works, only the
			// reload-without-consent nicety is lost.
		}
	}
}
