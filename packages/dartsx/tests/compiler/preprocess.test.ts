/**
 * Preprocessor snapshot tests + lexer unit tests.
 *
 * preprocessor/input.tsx is the canonical DarTsx corpus: its render
 * blocks cover every statement position that must rewrite to return
 * (block start, after ; and }, brace-less control bodies, else, ASI
 * newlines after statement-complete tokens). input.jsx is the plain-
 * JavaScript side: render in every expression position (assignments,
 * member calls and definitions, operands, property names, strings,
 * comments, regex/division contexts, JSX expression holes) that must
 * pass through untouched. input.jsx ends with malformed rows pinning
 * degenerate input. Run UPDATE_SNAPSHOTS=true to regenerate the _expected
 * files.
 *
 * The lexer describe below pins the internals the snapshots cannot
 * observe: token kinds and positions, newline (ASI) flags, delimiter
 * matching, and keyword-candidate context (including JSX expression
 * holes).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { preprocess } from '../../src/compiler/phases/1-preprocess/index.js';
import { lex } from '../../src/compiler/phases/1-preprocess/lexer.js';

const DIR = join(__dirname, 'preprocessor');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

const fixtures = readdirSync(DIR, { withFileTypes: true })
	.filter((e) => e.isFile() && !e.name.startsWith('_') && /\.(tsx|jsx|js|ts)$/.test(e.name))
	.map((e) => e.name)
	.sort();

describe('preprocessor', () => {
	beforeAll(() => {
		rmSync(join(DIR, '_output'), { recursive: true, force: true });
		mkdirSync(join(DIR, '_output'), { recursive: true });
		if (!UPDATE) return;
		rmSync(join(DIR, '_expected'), { recursive: true, force: true });
		mkdirSync(join(DIR, '_expected'), { recursive: true });
		for (const name of fixtures) {
			const input = readFileSync(join(DIR, name), 'utf-8');
			const { code } = preprocess(input.trim(), { filename: name });
			writeFileSync(join(DIR, '_expected', name), code.trimEnd() + '\n');
		}
	});

	for (const name of fixtures) {
		it(name, () => {
			const input = readFileSync(join(DIR, name), 'utf-8');
			const { code } = preprocess(input.trim(), { filename: name });
			const actual = code.trimEnd() + '\n';
			writeFileSync(join(DIR, '_output', name), actual);

			const expectedPath = join(DIR, '_expected', name);
			if (!existsSync(expectedPath)) {
				throw new Error(`Missing snapshot: _expected/${name}. Run UPDATE_SNAPSHOTS=true pnpm test to generate.`);
			}
			const expected = readFileSync(expectedPath, 'utf-8');
			expect(actual, `Mismatch: ${name}`).toBe(expected);
		});
	}
});

describe('lexer', () => {
	it('produces significant tokens with positions', () => {
		const { tokens } = lex('const x = 1;');
		expect(tokens.map((t) => [t.kind, t.text, t.start, t.end])).toEqual([
			['word', 'const', 0, 5],
			['word', 'x', 6, 7],
			['operator', '=', 8, 9],
			['number', '1', 10, 11],
			['punct', ';', 11, 12],
		]);
	});

	it('records newline-before (ASI) flags', () => {
		const { tokens } = lex('const a = 1\nconst b = 2');
		expect(tokens.find((t) => t.text === 'b')!.newlineBefore).toBe(false);
		expect(tokens.filter((t) => t.text === 'const')[1].newlineBefore).toBe(true);
	});

	it('matches nested delimiters once', () => {
		const { tokens, matchIndex } = lex('foo(a, [b], {c})');
		const openIdx = tokens.findIndex((t) => t.text === '(');
		const closeIdx = tokens.findIndex((t) => t.text === ')');
		expect(matchIndex.get(openIdx)).toBe(closeIdx);
	});

	it('records no match for unbalanced delimiters', () => {
		const { tokens, matchIndex } = lex('foo((');
		const openIdx = tokens.findIndex((t) => t.text === '(');
		expect(matchIndex.has(openIdx)).toBe(false);
	});

	it('snapshots render candidates with statement context', () => {
		const { keywords, tokens } = lex('foo(render(a));\nif (x) render (b)');
		expect(keywords).toHaveLength(2);
		expect(keywords[0].enclosed).toBe(true); // inside foo( …
		expect(keywords[1].enclosed).toBe(false);
		expect(keywords[1].prev?.text).toBe(')');
		expect(tokens[keywords[1].index + 1].text).toBe('(');
	});

	it('flags a keyword opening a JSX expression hole, not one inside a hole block', () => {
		const child = lex('<p>{render(x)}</p>').keywords;
		expect(child).toHaveLength(1);
		expect(child[0].jsxHoleStart).toBe(true);
		expect(child[0].enclosed).toBe(false);

		const attr = lex('<div a={render(x)} />').keywords;
		expect(attr).toHaveLength(1);
		expect(attr[0].jsxHoleStart).toBe(true);

		// anonymous block in a hole: `render` follows `;` — statement position
		const anon = lex('<p>{ const a = 1; render <b/> }</p>').keywords;
		expect(anon).toHaveLength(1);
		expect(anon[0].jsxHoleStart).toBe(false);

		const block = lex('function f() { render(x) }').keywords;
		expect(block).toHaveLength(1);
		expect(block[0].jsxHoleStart).toBe(false);
	});
});
