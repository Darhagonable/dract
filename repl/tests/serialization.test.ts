// Kernel guardrails: shared-link serialization. The hash payload is
// UNTRUSTED input, and the consent gate depends on byte-exact round-trips —
// both must hold independently of the engine.
import { describe, expect, it } from 'vitest';
import {
	decodePlaygroundHash,
	encodePlaygroundHash,
	MAX_PLAYGROUND_FILES,
	MAX_PLAYGROUND_SOURCE_LENGTH,
	PLAYGROUND_SOURCE_LIMIT_ERROR,
	type PlaygroundHashPayload,
	type PlaygroundHashResult,
} from '../src/kernel/serialization.ts';
import { Workspace } from '../src/kernel/workspace.ts';
import type { PlaygroundFile } from '../src/kernel/types.ts';

const FILES: PlaygroundFile[] = [
	{ name: 'App.tsx', source: 'export default function App() {}' },
	{ name: 'store.ts', source: 'export const x = 1;' },
];

/** Narrow a decode result to its payload, failing the test on rejection. */
function payload(result: PlaygroundHashResult): PlaygroundHashPayload | null {
	if (!result.ok) throw new Error(`decode rejected: ${result.error}`);
	return result.value;
}

function encode(files: PlaygroundFile[] = FILES, entry = 'App.tsx'): string {
	return encodePlaygroundHash({ lang: 'tsx', entry, files });
}

describe('share-hash payload', () => {
	it('round-trips the current v2 payload', () => {
		const decoded = decodePlaygroundHash(encode());
		expect(decoded).toEqual({
			ok: true,
			value: { lang: 'tsx', entry: 'App.tsx', files: FILES },
		});
	});

	it('decodes an empty fragment to "no payload"', () => {
		expect(decodePlaygroundHash('')).toEqual({ ok: true, value: null });
	});

	it('keeps legacy single-file payloads working', () => {
		const legacy = btoa(JSON.stringify({ s: 'legacy source', l: 'tsx' }));
		expect(payload(decodePlaygroundHash(legacy))).toEqual({
			lang: 'tsx',
			entry: 'App.tsx',
			files: [{ name: 'App.tsx', source: 'legacy source' }],
		});
	});

	it('rejects malformed or foreign payloads without erroring', () => {
		for (const bad of ['not base64 !!', btoa('"just a string"'), btoa('{"v":3}')]) {
			expect(decodePlaygroundHash(bad)).toEqual({ ok: true, value: null });
		}
	});

	it('ignores oversized encoded input', () => {
		const hostile = 'A'.repeat(MAX_PLAYGROUND_SOURCE_LENGTH * 10);
		expect(decodePlaygroundHash(hostile)).toEqual({
			ok: false,
			error: PLAYGROUND_SOURCE_LIMIT_ERROR,
		});
	});

	it('enforces structural validation on v2 payloads', () => {
		const wrap = (body: unknown) => btoa(JSON.stringify(body));
		const rejected = (body: unknown) => payload(decodePlaygroundHash(wrap(body)));
		// Wrong dialect.
		expect(rejected({ v: 2, l: 'js', e: 'App.js', f: [] })).toBeNull();
		// No files / too many files.
		expect(rejected({ v: 2, l: 'tsx', e: 'App.tsx', f: [] })).toBeNull();
		expect(
			rejected({
				v: 2,
				l: 'tsx',
				e: 'F0.tsx',
				f: Array.from({ length: MAX_PLAYGROUND_FILES + 1 }, (_, i) => ({
					n: `F${i}.tsx`,
					s: '',
				})),
			}),
		).toBeNull();
		// Duplicate names / unacceptable names / missing entry.
		expect(rejected({ v: 2, l: 'tsx', e: 'A.tsx', f: [
			{ n: 'A.tsx', s: '' }, { n: 'A.tsx', s: '' },
		] })).toBeNull();
		expect(rejected({ v: 2, l: 'tsx', e: 'a/b.tsx', f: [
			{ n: 'a/b.tsx', s: '' },
		] })).toBeNull();
		expect(rejected({ v: 2, l: 'tsx', e: 'Missing.tsx', f: FILES })).toBeNull();
		// The tsconfig may exist in a payload but never BE the entry.
		expect(rejected({ v: 2, l: 'tsx', e: 'tsconfig.json', f: [
			{ n: 'tsconfig.json', s: '{}' },
		] })).toBeNull();
	});

	it('refuses to encode over-budget workspaces', () => {
		const huge: PlaygroundFile[] = [
			{ name: 'App.tsx', source: 'a'.repeat(MAX_PLAYGROUND_SOURCE_LENGTH + 1) },
		];
		expect(encode(huge)).toBe('');
	});

	it('hash → decode → Workspace yields the same project (kernel-level invariant)', () => {
		const workspace = new Workspace({ entry: 'App.tsx', files: FILES });
		workspace.ensureTsconfig('{}');
		const hash = encode([...workspace.files], workspace.entry);

		const decoded = payload(decodePlaygroundHash(hash))!;
		const restored = new Workspace({ entry: decoded.entry, files: decoded.files });

		expect(restored.entry).toBe(workspace.entry);
		expect(restored.files).toEqual(workspace.files);
	});
});
