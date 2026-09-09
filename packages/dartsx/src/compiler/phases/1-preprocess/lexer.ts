/**
 * DarTsx lexical scanner.
 *
 * A single linear pass over raw (pre-transform) DarTsx source producing just
 * enough lexical structure for the preprocessor's transforms: significant
 * tokens with positions and ASI (newline-before) flags, delimiter matching,
 * `render` candidates with their statement context, and skip ranges for
 * strings/templates/regexes/comments that regex-driven transforms must not
 * touch.
 *
 * This is deliberately not a JavaScript parser — `state`, `derived`,
 * `component` and `render` are ordinary word tokens; the DarTsx transforms
 * decide what they mean. It only needs to get the *lexical* facts right,
 * including the two context-sensitive calls every JS lexer must make:
 * regex-vs-division for `/` and JSX-vs-less-than for `<`.
 */

// ── Types ──────────────────────────────────────────────────────────

export type TokenKind =
	| 'word'
	| 'number'
	| 'string'
	| 'template'
	| 'regex'
	| 'jsx'
	| 'punct'
	| 'operator';

export interface Token {
	kind: TokenKind;
	/** Raw source text of the token (punct: the single character). */
	text: string;
	start: number;
	end: number;
	/** Whether a line break separates this token from the previous one. */
	newlineBefore: boolean;
}

/** A DarTsx keyword word token with the context needed to classify it. */
export interface KeywordCandidate {
	/** Index into `LexResult.tokens`. */
	index: number;
	token: Token;
	/** Previous significant token (comments/whitespace excluded). */
	prev: Token | undefined;
	/** Whether the delimiter-stack top is `(` or `[` — an expression slot. */
	enclosed: boolean;
	/**
	 * Whether the keyword is the first significant token inside a JSX
	 * expression hole (`{render(x)}`, `attr={render(x)}`) — an expression
	 * slot. Later tokens in a hole can open an anonymous/control-flow
	 * block (`{ const a = …; render … }`), so only the leading position
	 * is excluded.
	 */
	jsxHoleStart: boolean;
}

/** DarTsx declaration keywords tracked with their statement context. */
const DARTSX_KEYWORDS = new Set(['render', 'state', 'derived', 'component']);

export interface LexResult {
	tokens: Token[];
	/** Token index of an opening `(` `[` `{` → token index of its closer. */
	matchIndex: Map<number, number>;
	/** Every `render`/`state`/`derived`/`component` word token with statement context. */
	keywords: KeywordCandidate[];
}

// ── Character classes ──────────────────────────────────────────────

const ID_START = /[A-Za-z_$]/;
const ID_CONTINUE = /[A-Za-z0-9_$]/;
const ID_START_UNI = /[\p{ID_Start}$_]/u;
const ID_CONTINUE_UNI = /[\p{ID_Continue}$\u200C\u200D]/u;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

function isIdentStart(ch: string | undefined): boolean {
	if (ch === undefined) return false;
	if (ID_START.test(ch)) return true;
	return ch.charCodeAt(0) > 127 && ID_START_UNI.test(ch);
}

function isIdentContinue(ch: string | undefined): boolean {
	if (ch === undefined) return false;
	if (ID_CONTINUE.test(ch)) return true;
	return ch.charCodeAt(0) > 127 && ID_CONTINUE_UNI.test(ch);
}

// ── Operators & punctuation ────────────────────────────────────────

/** Multi-char operators first so maximal munch wins; `.` `:` `;` `,` `?` and delimiters are punct. */
const OPERATORS = [
	'>>>=',
	'...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
	'=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '**',
	'+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
	'=', '+', '-', '*', '/', '%', '&', '|', '^', '!', '<', '>', '~',
];

const OPEN_FOR: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Words after which an expression may begin — regex literals and JSX
 * elements are legal here (`return /x/.test(s)`, `render <p/>`).
 * `render` additionally allows JSX because the DarTsx keyword takes one.
 */
const EXPRESSION_START_KEYWORDS = new Set([
	'return', 'throw', 'await', 'typeof', 'new', 'case', 'void', 'yield',
	'delete', 'instanceof', 'in', 'of', 'else', 'do', 'render',
]);

/** Operators that end a value: `/` after them is division, never a regex. */
const REGEX_CLOSING_OPERATORS = new Set(['>', '>=', '>>', '>>>', '>>=', '>>>=', '++', '--']);

function regexAllowedAfter(prev: Token | undefined): boolean {
	if (!prev) return true;
	if (prev.kind === 'word') return EXPRESSION_START_KEYWORDS.has(prev.text);
	if (prev.kind === 'operator') return !REGEX_CLOSING_OPERATORS.has(prev.text);
	if (prev.kind === 'punct') return prev.text !== ')' && prev.text !== ']' && prev.text !== '.';
	return false;
}

function jsxAllowedAfter(prev: Token | undefined): boolean {
	if (!prev) return true;
	if (prev.kind === 'operator' || prev.kind === 'jsx') return true;
	if (prev.kind === 'word') return EXPRESSION_START_KEYWORDS.has(prev.text);
	if (prev.kind === 'punct') return prev.text !== '.';
	return false;
}

// ── Literal scanners ───────────────────────────────────────────────

/**
 * Skip a `'…'`/`"…"`/`` `…` `` literal, honoring escapes and `${…}`
 * interpolation (including nested braces, strings and backticks).
 */
export function skipString(source: string, start: number): number {
	const quote = source[start];
	let i = start + 1;
	while (i < source.length) {
		if (source[i] === '\\') { i += 2; continue; }
		if (source[i] === quote) return i + 1;
		if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
			let depth = 1;
			i += 2;
			while (i < source.length && depth > 0) {
				if (source[i] === '{') depth++;
				else if (source[i] === '}') depth--;
				else if (source[i] === '`') { i = skipString(source, i); continue; }
				i++;
			}
			continue;
		}
		i++;
	}
	return i;
}

/** Scan a regex literal from its opening `/`. Returns end offset or -1 if invalid (then `/` is division). */
function scanRegex(source: string, start: number): number {
	let i = start + 1;
	let inClass = false;
	while (i < source.length) {
		const ch = source[i];
		if (ch === '\\') { i += 2; continue; }
		if (ch === '\n') return -1;
		if (ch === '[') inClass = true;
		else if (ch === ']') inClass = false;
		else if (ch === '/' && !inClass) {
			i++;
			while (i < source.length && /[a-z]/i.test(source[i])) i++;
			return i;
		}
		i++;
	}
	return -1;
}

function scanWord(source: string, start: number): number {
	let i = start + 1;
	while (i < source.length && isIdentContinue(source[i])) i++;
	return i;
}

function scanNumber(source: string, start: number): number {
	let i = start;
	if (source[i] === '0' && /[xXbBoO]/.test(source[i + 1] ?? '')) {
		i += 2;
		while (i < source.length && /[0-9a-fA-F_]/.test(source[i])) i++;
	} else {
		while (i < source.length && /[0-9_]/.test(source[i])) i++;
		if (source[i] === '.') {
			i++;
			while (i < source.length && /[0-9_]/.test(source[i])) i++;
		}
		if (/[eE]/.test(source[i] ?? '')) {
			const save = i;
			i++;
			if (/[+-]/.test(source[i] ?? '')) i++;
			if (DIGIT.test(source[i] ?? '')) {
				while (i < source.length && /[0-9_]/.test(source[i])) i++;
			} else {
				i = save;
			}
		}
	}
	if (source[i] === 'n') i++;
	return i;
}

/** Find the end of a JSX element starting at `<`. Returns position after element, or -1. */
export function findJSXEnd(source: string, start: number, end = source.length): number {
	if (source[start] !== '<') return -1;
	let pos = start + 1;
	while (pos < end && /[a-zA-Z0-9._$]/.test(source[pos])) pos++;
	let depth = 1;
	while (pos < end && depth > 0) {
		if (source[pos] === '/' && source[pos + 1] === '>') {
			depth--;
			pos += 2;
		} else if (source[pos] === '<' && source[pos + 1] === '/') {
			depth--;
			const gt = source.indexOf('>', pos + 2);
			pos = gt !== -1 ? gt + 1 : pos + 2;
		} else if (source[pos] === '<' && source[pos + 1] !== '/' && source[pos + 1] !== '!') {
			depth++;
			pos++;
		} else if (source[pos] === '>' && depth === 1) {
			pos++;
		} else if (source[pos] === '{') {
			const close = findMatchingBrace(source, pos);
			if (close === -1) return -1;
			pos = close + 1;
		} else if (source[pos] === "'" || source[pos] === '"' || source[pos] === '`') {
			pos = skipString(source, pos);
		} else {
			pos++;
		}
	}
	return depth === 0 ? pos : -1;
}

function findMatching(code: string, openPos: number, open: string, close: string): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === open) depth++;
		else if (ch === close) { depth--; if (depth === 0) return i; }
		else if (ch === "'" || ch === '"' || ch === '`') { i = skipString(code, i); continue; }
		i++;
	}
	return -1;
}

const findMatchingBrace = (code: string, pos: number) => findMatching(code, pos, '{', '}');

// ── Main scan ──────────────────────────────────────────────────────

type Mode = 'code' | 'tag' | 'text';

export function lex(source: string): LexResult {
	const tokens: Token[] = [];
	const keywords: KeywordCandidate[] = [];
	const matchIndex = new Map<number, number>();
	const stack: { text: string; tokenIndex: number; returnTo?: 'tag' | 'text'; tagStart?: number; tagOrigin?: Mode }[] = [];
	let mode: Mode = 'code';
	// For each element whose children are being scanned ('text' mode):
	// the mode to restore when its closing tag appears.
	const textReturnModes: Mode[] = [];
	// While inside a JSX opening tag: where the tag began and the mode
	// to restore if it turns out self-closing (or malformed).
	let tagStart = -1;
	let tagOrigin: Mode = 'code';
	let prev: Token | undefined;
	let newline = false;
	let i = 0;

	const push = (kind: TokenKind, start: number, end: number, text?: string): void => {
		const token: Token = { kind, text: text ?? source.slice(start, end), start, end, newlineBefore: newline };
		tokens.push(token);
		if (kind === 'word' && DARTSX_KEYWORDS.has(token.text)) {
			const top = stack[stack.length - 1];
			keywords.push({
				index: tokens.length - 1,
				token,
				prev,
				enclosed: top !== undefined && (top.text === '(' || top.text === '['),
				jsxHoleStart: top !== undefined && top.text === '{' && top.returnTo !== undefined
					&& tokens.length - 1 === top.tokenIndex + 1,
			});
		}
		prev = token;
		newline = false;
	};

	/** Enter a `{…}` expression hole: emit the brace, remember where tag/text
	 * scanning resumes when it closes, and lex the contents as code. */
	const enterHole = (returnTo: 'tag' | 'text'): void => {
		push('punct', i, i + 1, '{');
		stack.push({ text: '{', tokenIndex: tokens.length - 1, returnTo, tagStart, tagOrigin });
		mode = 'code';
		i++;
	};

	while (i < source.length) {
		// ── JSX children: inert text until { or < ──
		if (mode === 'text') {
			const ch = source[i];
			if (ch === '\n') { newline = true; i++; continue; }
			if (ch === '{') {
				enterHole('text');
				continue;
			}
			if (ch === '<') {
				if (source.startsWith('<!--', i)) {
					const closeIdx = source.indexOf('-->', i + 4);
					const end = closeIdx === -1 ? source.length : closeIdx + 3;
					const nl = source.indexOf('\n', i);
					if (nl !== -1 && nl < end) newline = true;
					i = end;
					continue;
				}
				if (source[i + 1] === '/') {
					// closing tag ends this element's children
					const gt = source.indexOf('>', i + 2);
					if (gt === -1) { i = source.length; continue; }
					const end = gt + 1;
					push('jsx', i, end);
					i = end;
					mode = textReturnModes.pop() ?? 'code';
					continue;
				}
				if (isIdentStart(source[i + 1]) || source[i + 1] === '>') {
					tagStart = i;
					tagOrigin = 'text';
					mode = 'tag';
					i++;
					continue;
				}
				i++; // stray '<' in text
				continue;
			}
			i++;
			continue;
		}

		// ── JSX opening-tag innards: names, attrs, strings, {expr} holes ──
		if (mode === 'tag') {
			const ch = source[i];
			if (ch === '\n') { newline = true; i++; continue; }
			if (WHITESPACE.test(ch)) { i++; continue; }
			if (ch === '"' || ch === "'" || ch === '`') {
				const end = skipString(source, i);
				push('string', i, end);
				i = end;
				continue;
			}
			if (ch === '{') {
				enterHole('tag');
				continue;
			}
			if (ch === '>') {
				// open tag: children follow as text
				push('jsx', tagStart, i + 1);
				i++;
				mode = 'text';
				textReturnModes.push(tagOrigin);
				continue;
			}
			if (ch === '/' && source[i + 1] === '>') {
				push('jsx', tagStart, i + 2); // self-closing element
				i += 2;
				mode = tagOrigin;
				continue;
			}
			if (/[A-Za-z0-9_$:.-]/.test(ch) || ch === '=') { i++; continue; }
			// Malformed tag: treat the '<' as an operator and resume normally
			push('operator', tagStart, tagStart + 1, '<');
			i = tagStart + 1;
			mode = tagOrigin;
			continue;
		}

		// ── Code ──
		const ch = source[i];

		if (ch === '\n') { newline = true; i++; continue; }
		if (ch === '\uFEFF' || WHITESPACE.test(ch)) { i++; continue; }

		// Comments
		if (ch === '/' && source[i + 1] === '/') {
			let end = source.indexOf('\n', i);
			if (end === -1) end = source.length;
			i = end;
			continue;
		}
		if (ch === '/' && source[i + 1] === '*') {
			const close = source.indexOf('*/', i + 2);
			const end = close === -1 ? source.length : close + 2;
			const nl = source.indexOf('\n', i);
			if (nl !== -1 && nl < end) newline = true;
			i = end;
			continue;
		}

		// Regex literal (vs division)
		if (ch === '/' && regexAllowedAfter(prev)) {
			const end = scanRegex(source, i);
			if (end !== -1) {
				push('regex', i, end);
				i = end;
				continue;
			}
			// invalid regex → division operator, fall through
		}

		// Strings & templates
		if (ch === '"' || ch === "'" || ch === '`') {
			const end = skipString(source, i);
			push(ch === '`' ? 'template' : 'string', i, end);
			i = end;
			continue;
		}

		// JSX element (vs less-than): only where an expression may begin
		if (ch === '<' && jsxAllowedAfter(prev) && (isIdentStart(source[i + 1]) || source[i + 1] === '>')) {
			tagStart = i;
			tagOrigin = 'code';
			mode = 'tag';
			i++;
			continue;
		}

		// Words & numbers
		if (isIdentStart(ch)) {
			const end = scanWord(source, i);
			push('word', i, end);
			i = end;
			continue;
		}
		if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(source[i + 1] ?? ''))) {
			const end = scanNumber(source, i);
			push('number', i, end);
			i = end;
			continue;
		}

		// Multi-char operators (before punct so `...` `?.` `=>` win)
		let matched = false;
		for (const op of OPERATORS) {
			if (source.startsWith(op, i)) {
				push('operator', i, i + op.length, op);
				i += op.length;
				matched = true;
				break;
			}
		}
		if (matched) continue;

		// Punctuation & delimiters
		if ('()[]{};,:.?'.includes(ch)) {
			push('punct', i, i + 1, ch);
			if (ch === '(' || ch === '[' || ch === '{') {
				stack.push({ text: ch, tokenIndex: tokens.length - 1 });
			} else if (ch === '}' && stack.length > 0 && stack[stack.length - 1].returnTo !== undefined) {
				// closes a JSX expression hole: return to tag/text scanning,
				// restoring the interrupted tag's position and origin
				const opener = stack.pop()!;
				matchIndex.set(opener.tokenIndex, tokens.length - 1);
				mode = opener.returnTo!;
				if (opener.tagStart !== undefined) tagStart = opener.tagStart;
				if (opener.tagOrigin !== undefined) tagOrigin = opener.tagOrigin;
			} else {
				const open = OPEN_FOR[ch];
				if (stack.length > 0 && stack[stack.length - 1].text === open) {
					const opener = stack.pop()!;
					matchIndex.set(opener.tokenIndex, tokens.length - 1);
				}
			}
			i++;
			continue;
		}

		// Anything else (@, #, \ …): inert single-character token
		push('operator', i, i + 1);
		i++;
	}

	return { tokens, matchIndex, keywords };
}
