/**
 * DarTsx → TSX Transform
 *
 * Transforms DarTsx custom syntax into valid TypeScript/TSX that the
 * TypeScript language service can understand. Uses MagicString for
 * surgical text manipulation with automatic source map generation.
 *
 * Transforms:
 *   - `component Name(params)` → `function Name({params}: {types})`
 *   - `state x =` → `let x =`
 *   - `derived x =` → `const x =`
 *   - `render (...)` → `return (<>...</>)`
 *   - `render <expr>` → `return <expr>`
 *   - `render expr;` → `return expr;`
 *   - `{if/for/switch/try}` in JSX → IIFE wrappers
 *   - `bind:{x}` → `bind:x={x}` (shorthand expansion)
 *   - `{@html expr}` → `{expr}`
 *   - `<style>` blocks → blanked (preserving interpolations)
 */

import MagicString from 'magic-string';
import type { SourceMap } from 'magic-string';

export type { SourceMap };

export interface TransformResult {
	/** The transformed valid TSX code */
	code: string;
	/** Full V3 source map object */
	map: SourceMap;
}

/**
 * Detect whether a .tsx file contains DarTsx syntax.
 */
export function isDarTsxFile(content: string): boolean {
	return /\bcomponent\s+\w+\s*\(/.test(content)
		|| /\bstate\s+\w+/.test(content)
		|| /\bderived\s+\w+/.test(content)
		|| /\bderived\s+[{[]/.test(content)
		|| /\brender\s*[(<]/.test(content)
		|| /<[^>]*\bbind:(?:\{[a-zA-Z_]\w*\}|[a-zA-Z][\w-]*)\b/.test(content);
}

/**
 * Transform DarTsx source into valid TSX.
 */
export function dartsxToTsx(source: string): TransformResult {
	const ms = new MagicString(source);
	const commentRanges = buildCommentRanges(source);

	transformComponentDeclarations(ms, source, commentRanges);
	transformStateDeclarations(ms, source, commentRanges);
	transformDerivedDeclarations(ms, source, commentRanges);
	transformDefiniteAssignments(ms, source, commentRanges);
	const renderRanges = transformRenderBlocks(ms, source);
	wrapAllJSXExpressions(ms, source, renderRanges);
	transformJsxAttributes(ms, source);
	blankStyleBlocks(ms, source);

	const code = ms.toString();
	const map = ms.generateMap({ hires: 'boundary' });
	return { code, map };
}

// ── Comment & string literal detection ─────────────────────────────

type SkipRange = { start: number; end: number };

function buildCommentRanges(source: string): SkipRange[] {
	const ranges: SkipRange[] = [];
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === '/' && source[i + 1] === '/') {
			const start = i;
			i = source.indexOf('\n', i);
			if (i === -1) i = source.length;
			ranges.push({ start, end: i });
		} else if (ch === '/' && source[i + 1] === '*') {
			const start = i;
			i = source.indexOf('*/', i + 2);
			i = i === -1 ? source.length : i + 2;
			ranges.push({ start, end: i });
		} else if (ch === '\'' || ch === '"' || ch === '`') {
			const start = i;
			i = skipString(source, i);
			ranges.push({ start, end: i });
		} else {
			i++;
		}
	}
	return ranges;
}

function isInComment(ranges: SkipRange[], pos: number): boolean {
	for (const r of ranges) {
		if (pos >= r.start && pos < r.end) return true;
		if (r.start > pos) break;
	}
	return false;
}

function skipString(source: string, start: number): number {
	const quote = source[start];
	let i = start + 1;
	while (i < source.length) {
		if (source[i] === '\\') { i += 2; continue; }
		if (source[i] === quote) return i + 1;
		if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
			// Skip template expression — simplified (doesn't handle nested templates)
			let depth = 1;
			i += 2;
			while (i < source.length && depth > 0) {
				if (source[i] === '{') depth++;
				else if (source[i] === '}') depth--;
				i++;
			}
			continue;
		}
		i++;
	}
	return i;
}

// ── component → function (with props destructuring) ───────────────

function transformComponentDeclarations(ms: MagicString, source: string, commentRanges: SkipRange[]): void {
	const re = /\b((?:export\s+)?(?:default\s+)?(?:async\s+)?)component(\s+\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		// Replace component → function
		const prefixEnd = match.index + match[1].length;
		ms.overwrite(prefixEnd, prefixEnd + 'component'.length, 'function');

		// Find the param list
		const openParen = source.indexOf('(', match.index + match[0].length);
		if (openParen === -1) continue;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;

		const paramRanges = splitParamRanges(source, openParen + 1, closeParen);
		if (paramRanges.length === 0) continue;
		const parsed = paramRanges.map(r => parseOneParam(r.text));

		// Build the type annotation as new text (not mapped to original positions)
		const typeParts: string[] = [];
		for (const p of parsed) {
			if (p.isRest) {
				typeParts.push('[key: string]: any');
			} else {
				const key = p.externalName !== null ? `'${p.externalName}'` : p.localName;
				const optional = (p.isOptional || p.defaultValue !== null) ? '?' : '';
				const type = p.type ?? 'any';
				typeParts.push(`${key}${optional}: ${type}`);
			}
		}

		// Replace ( with ({ — original param positions become destructuring bindings
		ms.overwrite(openParen, openParen + 1, '({');
		// Replace ) with }: {type annotation})
		ms.overwrite(closeParen, closeParen + 1, `}: {${typeParts.join(', ')}})`);

		// Edit each param IN PLACE to become a destructuring binding
		for (let i = 0; i < paramRanges.length; i++) {
			editParamForDestructuring(ms, source, paramRanges[i], parsed[i]);
		}
	}
}

interface ParamRange {
	text: string;
	start: number;
	end: number;
}

interface ParsedParam {
	isBind: boolean;
	isRest: boolean;
	isOptional: boolean;
	externalName: string | null;
	localName: string;
	type: string | null;
	defaultValue: string | null;
}

function splitParamRanges(source: string, start: number, end: number): ParamRange[] {
	const ranges: ParamRange[] = [];
	let depth = 0;
	let current = start;
	for (let i = start; i < end; i++) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(source, i) - 1;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) {
			ranges.push({ text: source.slice(current, i), start: current, end: i });
			current = i + 1;
		}
	}
	const lastText = source.slice(current, end);
	if (lastText.trim()) ranges.push({ text: lastText, start: current, end });
	return ranges;
}

/**
 * Edit a param range in place so the original tokens become a destructuring binding.
 * e.g. `bind 'ext' as name: string = 'x'` → `'ext': name`  (with name at original pos)
 * e.g. `age: number` → `age`
 * e.g. `active: boolean = true` → `active = true`  (keeps default at original pos)
 */
function editParamForDestructuring(
	ms: MagicString, source: string, range: ParamRange, param: ParsedParam,
): void {
	const raw = range.text;
	const leadingWs = raw.match(/^\s*/)![0].length;
	const contentStart = range.start + leadingWs;

	// Rest params: keep `...name` at original position
	if (param.isRest) {
		// Already looks like `...name` or `...name: Type` — just remove type
		const nameEnd = contentStart + 3 + param.localName.length; // `...` + name
		if (nameEnd < range.end) {
			ms.remove(nameEnd, range.end);
		}
		return;
	}

	let cursor = contentStart;

	// Remove `bind ` prefix
	if (param.isBind) {
		const bindMatch = source.slice(cursor, range.end).match(/^bind\s+/);
		if (bindMatch) {
			ms.remove(cursor, cursor + bindMatch[0].length);
			cursor += bindMatch[0].length;
		}
	}

	// Handle renamed params: `'ext-name' as localName: Type = default`
	// Want: `'ext-name': localName = default` (rename syntax in destructuring)
	if (param.externalName !== null) {
		const quote = source[cursor];
		const closeQuote = source.indexOf(quote, cursor + 1);
		if (closeQuote > 0) {
			const afterQuote = closeQuote + 1;
			// Find `as localName`
			const asMatch = source.slice(afterQuote, range.end).match(/^\s+as\s+/);
			if (asMatch) {
				// Replace ` as ` with `: ` (destructuring rename syntax)
				ms.overwrite(afterQuote, afterQuote + asMatch[0].length, ': ');
			}
			// Find the localName end
			const localStart = afterQuote + (asMatch ? asMatch[0].length : 0);
			const localEnd = localStart + param.localName.length;
			// Remove optional `?` after name
			let afterName = localEnd;
			if (source[afterName] === '?') {
				ms.remove(afterName, afterName + 1);
				afterName++;
			}
			// Remove `: Type` but keep ` = default`
			if (param.defaultValue !== null) {
				const eqPos = findDefaultEquals(source, afterName, range.end);
				if (eqPos >= 0) {
					// Remove from afterName to just before `= default` (keep space before =)
					let eqStart = eqPos;
					while (eqStart > afterName && source[eqStart - 1] === ' ') eqStart--;
					if (afterName < eqStart) {
						ms.remove(afterName, eqStart);
					}
				}
			} else {
				// Remove everything after localName
				if (afterName < range.end) {
					ms.remove(afterName, range.end);
				}
			}
		}
	} else {
		// Simple param: `name: Type = default` → `name = default` or just `name`
		const nameEnd = cursor + param.localName.length;
		// Remove optional `?` after name
		let afterName = nameEnd;
		if (source[afterName] === '?') {
			ms.remove(afterName, afterName + 1);
			afterName++;
		}
		// Remove `: Type` but keep ` = default`
		if (param.defaultValue !== null) {
			const eqPos = findDefaultEquals(source, afterName, range.end);
			if (eqPos >= 0) {
				// Remove from afterName to just before ` = default`
				let eqStart = eqPos;
				while (eqStart > afterName && source[eqStart - 1] === ' ') eqStart--;
				if (afterName < eqStart) {
					ms.remove(afterName, eqStart);
				}
			}
		} else {
			// No default — remove everything after name (the `: Type` part)
			if (afterName < range.end) {
				ms.remove(afterName, range.end);
			}
		}
	}
}

function parseOneParam(raw: string): ParsedParam {
	let s = raw.trim();

	// Rest param: ...name[: Type]
	if (s.startsWith('...')) {
		s = s.slice(3);
		const colonIdx = s.indexOf(':');
		const localName = (colonIdx >= 0 ? s.slice(0, colonIdx) : s).trim();
		const type = colonIdx >= 0 ? s.slice(colonIdx + 1).trim() : null;
		return { isBind: false, isRest: true, isOptional: false, externalName: null, localName, type, defaultValue: null };
	}

	// bind prefix
	let isBind = false;
	if (/^bind\s/.test(s)) {
		isBind = true;
		s = s.replace(/^bind\s+/, '');
	}

	// External name: 'ext-name' as local or "ext-name" as local
	let externalName: string | null = null;
	if (s[0] === "'" || s[0] === '"') {
		const quote = s[0];
		const closeQuote = s.indexOf(quote, 1);
		if (closeQuote > 0) {
			externalName = s.slice(1, closeQuote);
			s = s.slice(closeQuote + 1).replace(/^\s*as\s+/, '');
		}
	}

	// Local name (identifier)
	const nameMatch = s.match(/^[\w$]+/);
	if (!nameMatch) return { isBind, isRest: false, isOptional: false, externalName, localName: 'unknown', type: null, defaultValue: null };
	const localName = nameMatch[0];
	s = s.slice(nameMatch[0].length);

	// Optional marker
	let isOptional = false;
	if (s[0] === '?') {
		isOptional = true;
		s = s.slice(1);
	}
	s = s.trimStart();

	// Type annotation: : Type [= default]
	let type: string | null = null;
	let defaultValue: string | null = null;
	if (s[0] === ':') {
		s = s.slice(1).trimStart();
		const eqIdx = findDefaultEquals(s);
		if (eqIdx >= 0) {
			type = s.slice(0, eqIdx).trim();
			defaultValue = s.slice(eqIdx + 1).trim();
		} else {
			type = s.trim();
		}
	} else if (s[0] === '=') {
		defaultValue = s.slice(1).trim();
	}

	return { isBind, isRest: false, isOptional, externalName, localName, type, defaultValue };
}

/** Find first `=` at depth 0 in [start, end), skipping `=>` and `==` */
function findDefaultEquals(source: string, start = 0, end = source.length): number {
	let depth = 0;
	for (let i = start; i < end; i++) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(source, i) - 1;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === '=' && depth === 0 && source[i + 1] !== '>' && source[i + 1] !== '=') return i;
	}
	return -1;
}



// ── state x = → let x = ───────────────────────────────────────────

function transformStateDeclarations(ms: MagicString, source: string, commentRanges: SkipRange[]): void {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate(\s+(\w+))/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const stateStart = match.index + (match[1]?.length ?? 0);
		const stateEnd = stateStart + 'state'.length;
		ms.overwrite(stateStart, stateEnd, 'let');

		// If there's a type annotation, move it to `satisfies T as T` on the
		// initializer to prevent TS control-flow narrowing while keeping
		// type validation. `state x: T = init;` → `let x = init satisfies T as T;`
		const afterVar = stateEnd + match[2].length;
		const colonIdx = source.indexOf(':', afterVar);
		const eqIdx = source.indexOf('=', afterVar);
		if (colonIdx !== -1 && eqIdx !== -1 && colonIdx < eqIdx) {
			const typeText = source.slice(colonIdx + 1, eqIdx).trim();
			ms.overwrite(colonIdx, eqIdx, ' ');
			const semiIdx = source.indexOf(';', eqIdx);
			if (semiIdx !== -1) {
				ms.appendLeft(semiIdx, ` satisfies ${typeText} as ${typeText}`);
			}
		}
	}
}

// ── derived x = → const x = ───────────────────────────────────────

function transformDerivedDeclarations(ms: MagicString, source: string, commentRanges: SkipRange[]): void {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[\w{[])/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const derivedStart = match.index + (match[1]?.length ?? 0);
		ms.overwrite(derivedStart, derivedStart + 'derived'.length, 'const');
	}
}

// ── render (...) → return (<>...</>) ───────────────────────────────

// ── let x: T; → let x!: T; (definite assignment for element refs) ──

function transformDefiniteAssignments(ms: MagicString, source: string, commentRanges: SkipRange[]): void {
	// Match `let identifier: Type;` with no `=` (uninitialized typed let)
	const re = /\blet\s+(\w+)\s*:/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		// Check there's no `=` before the next `;` (i.e. no initializer)
		const afterColon = match.index + match[0].length;
		const semi = source.indexOf(';', afterColon);
		if (semi === -1) continue;
		const segment = source.slice(afterColon, semi);
		if (segment.includes('=')) continue;
		// Insert `!` after identifier: `let x: T;` → `let x!: T;`
		const nameEnd = match.index + match[0].length - 1; // position of `:`
		ms.appendLeft(nameEnd, '!');
	}
}

function transformRenderBlocks(ms: MagicString, source: string): [number, number][] {
	const re = /\brender\s*\(/g;
	const renderRanges: [number, number][] = [];
	let match;
	while ((match = re.exec(source)) !== null) {
		const renderStart = match.index;
		const openParen = renderStart + match[0].length - 1;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;

		const inner = source.slice(openParen + 1, closeParen);
		const trimmedInner = inner.trim();

		// render( → return(...)
		ms.overwrite(renderStart, openParen, 'return ');

		// Only wrap in fragment when there are multiple JSX roots
		if (trimmedInner.startsWith('<') && !isSingleJSXRoot(trimmedInner)) {
			ms.appendLeft(openParen + 1, '<>');
			ms.appendLeft(closeParen, '</>');
		}

		renderRanges.push([openParen + 1, closeParen]);
	}

	// render <expr> or render <JSX> → return ...
	const reOther = /\brender(\s+)(?!\()/g;
	while ((match = reOther.exec(source)) !== null) {
		ms.overwrite(match.index, match.index + 'render'.length, 'return');
	}

	return renderRanges;
}

function isSingleJSXRoot(code: string): boolean {
	const trimmed = code.trim();
	if (!trimmed.startsWith('<')) return false;
	const end = findJSXElementEnd(trimmed, 0);
	if (end <= 0) return false;
	return trimmed.slice(end).trim() === '';
}

function findJSXElementEnd(code: string, start: number): number {
	let i = start + 1;

	const tagStart = i;
	while (i < code.length && /[\w.$]/.test(code[i])) i++;
	const tagName = code.slice(tagStart, i);
	if (!tagName) return start;

	while (i < code.length) {
		if (code[i] === '/' && code[i + 1] === '>') return i + 2;
		if (code[i] === '>') { i++; break; }
		if (code[i] === '{') { i = skipJSXExpr(code, i); continue; }
		if (code[i] === "'" || code[i] === '"') { i = skipString(code, i); continue; }
		i++;
	}

	let nesting = 1;
	while (i < code.length && nesting > 0) {
		if (code[i] === '<') {
			if (code[i + 1] === '/') {
				const ns = i + 2;
				let ne = ns;
				while (ne < code.length && /[\w.$]/.test(code[ne])) ne++;
				if (code.slice(ns, ne) === tagName) {
					nesting--;
					if (nesting === 0) { while (ne < code.length && code[ne] !== '>') ne++; return ne + 1; }
				}
				i = ne;
			} else {
				const ns = i + 1;
				let ne = ns;
				while (ne < code.length && /[\w.$]/.test(code[ne])) ne++;
				if (code.slice(ns, ne) === tagName && !isSelfClosingJSXTag(code, ne)) nesting++;
				i = ne;
			}
			continue;
		}
		if (code[i] === '{') { i = skipJSXExpr(code, i); continue; }
		i++;
	}
	return i;
}

function skipJSXExpr(code: string, start: number): number {
	let depth = 1;
	let i = start + 1;
	while (i < code.length && depth > 0) {
		if (code[i] === '{') depth++;
		else if (code[i] === '}') depth--;
		else if (code[i] === "'" || code[i] === '"' || code[i] === '`') { i = skipString(code, i); continue; }
		i++;
	}
	return i;
}

function isSelfClosingJSXTag(code: string, attrStart: number): boolean {
	let j = attrStart;
	while (j < code.length && code[j] !== '>') {
		if (code[j] === '/' && code[j + 1] === '>') return true;
		if (code[j] === '{') { j = skipJSXExpr(code, j); continue; }
		if (code[j] === "'" || code[j] === '"') { j = skipString(code, j); continue; }
		j++;
	}
	return false;
}

/**
 * Wrap every JSX expression `{...}` in an IIFE: `{(() => { ... })()}`
 * Also strips for-clauses, rewrites paren bodies, and wraps multi-root parens in fragments.
 * Only operates within render block ranges.
 */
function wrapAllJSXExpressions(ms: MagicString, source: string, renderRanges: [number, number][]): void {
	function inRenderRange(pos: number): boolean {
		for (const [start, end] of renderRanges) {
			if (pos >= start && pos <= end) return true;
		}
		return false;
	}

	let i = 0;
	while (i < source.length) {
		if (source[i] === "'" || source[i] === '"' || source[i] === '`') { i = skipString(source, i); continue; }
		if (source[i] === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
		if (source[i] === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }

		if (source[i] === '{' && inRenderRange(i)) {
			if (isJSXExpressionContext(source, i)) {
				const closeBrace = findMatchingBrace(source, i);
				if (closeBrace !== -1) {
					const inner = source.slice(i + 1, closeBrace).trimStart();
					// Skip spread attributes
					if (inner.startsWith('...')) { i = closeBrace + 1; continue; }
					// @html directive: {@html expr} → {expr}
					if (inner.startsWith('@html')) {
						const expr = inner.slice(5).trim();
						ms.overwrite(i + 1, closeBrace, expr);
						i = closeBrace + 1;
						continue;
					}
					// Wrap in IIFE
					ms.appendLeft(i + 1, '(() => { ');
					ms.appendLeft(closeBrace, '})()');
					// Strip for-clauses and rewrite paren bodies
					stripForClauses(ms, source, i + 1, closeBrace);
					rewriteParenBodies(ms, source, i + 1, closeBrace);
					// Fragment-wrap multi-root paren bodies
					wrapMultiRootParenBodies(ms, source, i + 1, closeBrace);
					i++;
					continue;
				}
			} else {
				// In render range but not JSX expression — skip object literals
				let k = i - 1;
				while (k >= 0 && /\s/.test(source[k])) k--;
				const pc = k >= 0 ? source[k] : '';
				if (pc === '{' || pc === '=' || pc === '(') {
					const closeBrace = findMatchingBrace(source, i);
					if (closeBrace !== -1) { i = closeBrace + 1; continue; }
				}
			}
		}
		i++;
	}
}

/**
 * Determines whether a `{` at the given position is in JSX expression context
 * (as opposed to a function body, arrow body, else body, etc.)
 */
function isJSXExpressionContext(code: string, openBrace: number): boolean {
	let k = openBrace - 1;
	while (k >= 0 && /\s/.test(code[k])) k--;
	if (k < 0) return false;

	const pc = code[k];

	// Attribute value: attr={expr}
	if (pc === '=') return false;
	// Function/arrow/if/for body
	if (pc === '(') return false;
	if (pc === ')') return false;
	if (pc === '>' && k > 0 && code[k - 1] === '=') return false;
	if (/\belse$/.test(code.slice(Math.max(0, k - 4), k + 1))) return false;
	if (/\btry$/.test(code.slice(Math.max(0, k - 2), k + 1))) return false;
	if (/\bpending$/.test(code.slice(Math.max(0, k - 6), k + 1))) return false;

	// case/default label
	if (pc === ':') {
		let t = k - 1;
		while (t >= 0 && /\s/.test(code[t])) t--;
		if (t >= 0 && (code[t] === "'" || code[t] === '"')) return false;
		if (t >= 0 && /\w/.test(code[t])) {
			let idEnd = t;
			while (t >= 0 && /\w/.test(code[t])) t--;
			const word = code.slice(t + 1, idEnd + 1);
			if (word === 'case' || word === 'default') return false;
			const lineStart = code.lastIndexOf('\n', k);
			if (/^case\b/.test(code.slice(lineStart + 1, k + 1).trim())) return false;
			let ss = t;
			while (ss >= 0 && /\s/.test(code[ss])) ss--;
			if (ss < 0 || code[ss] === ';' || code[ss] === '}' || code[ss] === '{' || code[ss] === '\n') return false;
		}
	}

	// Return type annotation: `): ReturnType {`
	if (/[\w\]>}]/.test(pc)) {
		let t = k;
		while (t >= 0) {
			if (/[\w.$]/.test(code[t])) { t--; continue; }
			if (code[t] === '|' || code[t] === '&') { t--; continue; }
			if (/\s/.test(code[t])) { t--; continue; }
			if (code[t] === ']' && t > 0 && code[t - 1] === '[') { t -= 2; continue; }
			if (code[t] === '>') { let d = 1; t--; while (t >= 0 && d > 0) { if (code[t] === '>') d++; else if (code[t] === '<') d--; t--; } continue; }
			if (code[t] === '}') { let d = 1; t--; while (t >= 0 && d > 0) { if (code[t] === '}') d++; else if (code[t] === '{') d--; t--; } continue; }
			if (code[t] === ')') { let d = 1; t--; while (t >= 0 && d > 0) { if (code[t] === ')') d++; else if (code[t] === '(') d--; t--; } continue; }
			break;
		}
		while (t >= 0 && /\s/.test(code[t])) t--;
		if (t >= 0 && code[t] === ':') {
			t--;
			while (t >= 0 && /\s/.test(code[t])) t--;
			if (t >= 0 && code[t] === ')') return false;
		}
	}

	return true;
}

/**
 * Find paren bodies `(...)` that contain multiple JSX roots and wrap in `<>...</>`.
 */
function wrapMultiRootParenBodies(ms: MagicString, source: string, start: number, end: number): void {
	let i = start;
	while (i < end) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') { i = skipString(source, i); continue; }
		if (ch === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
		if (ch === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }
		if (ch === '{') {
			const close = findMatchingBrace(source, i);
			if (close !== -1) {
				if (!isJSXExpressionContext(source, i)) {
					wrapMultiRootParenBodies(ms, source, i + 1, close);
				}
				i = close + 1;
				continue;
			}
		}
		if (ch === '(') {
			const closeParen = findMatchingParen(source, i);
			if (closeParen !== -1 && closeParen < end) {
				const inner = source.slice(i + 1, closeParen).trim();
				if (inner.startsWith('<') && !isSingleJSXRoot(inner)) {
					ms.appendLeft(i + 1, '<>');
					ms.appendLeft(closeParen, '</>');
				}
				wrapMultiRootParenBodies(ms, source, i + 1, closeParen);
				i = closeParen + 1;
				continue;
			}
		}
		i++;
	}
}

/**
 * Info about for-loop clauses stripped from the header.
 */
interface ForClauseInfo {
	indexVar?: { start: number; end: number };
	keyExpr?: { start: number; end: number };
}

/**
 * Strip `; index <var>` and `; key <expr>` clauses from for-loop headers.
 * Uses ms.move() to preserve source mappings.
 */
function stripForClauses(ms: MagicString, source: string, start: number, end: number): void {
	let pos = start;
	while (pos < end) {
		if (source[pos] === "'" || source[pos] === '"' || source[pos] === '`') { pos = skipString(source, pos); continue; }
		if (source[pos] === '{') {
			const close = findMatchingBrace(source, pos);
			if (close !== -1) { pos = close + 1; continue; }
		}
		if (source[pos] === 'f' && /^for\s*[\s(]/.test(source.slice(pos, pos + 10))) {
			let p = pos + 3;
			while (p < end && /\s/.test(source[p])) p++;
			if (p >= end || source[p] !== '(') { pos++; continue; }
			const closeParen = findMatchingParen(source, p);
			if (closeParen === -1 || closeParen >= end) { pos++; continue; }

			const header = source.slice(p + 1, closeParen);
			const clauseRe = /;\s*(index|key)\s+/g;
			let firstClauseIdx = -1;
			let indexVarRange: { start: number; end: number } | undefined;
			let keyExprRange: { start: number; end: number } | undefined;
			let clauseMatch;

			while ((clauseMatch = clauseRe.exec(header)) !== null) {
				if (firstClauseIdx === -1) firstClauseIdx = clauseMatch.index;
				const afterKw = clauseMatch.index + clauseMatch[0].length;
				if (clauseMatch[1] === 'index') {
					const varMatch = header.slice(afterKw).match(/^([A-Za-z_$][\w$]*)/);
					if (varMatch) {
						const s = p + 1 + afterKw;
						indexVarRange = { start: s, end: s + varMatch[1].length };
					}
				} else if (clauseMatch[1] === 'key') {
					const s = p + 1 + afterKw;
					const nextSemi = header.indexOf(';', afterKw);
					let exprEnd = nextSemi !== -1 ? p + 1 + nextSemi : closeParen;
					while (exprEnd > s && /\s/.test(source[exprEnd - 1])) exprEnd--;
					keyExprRange = { start: s, end: exprEnd };
				}
			}

			if (firstClauseIdx !== -1) {
				const removeStart = p + 1 + firstClauseIdx;
				if (indexVarRange && keyExprRange) {
					const first = indexVarRange.start < keyExprRange.start ? indexVarRange : keyExprRange;
					const second = indexVarRange.start < keyExprRange.start ? keyExprRange : indexVarRange;
					ms.remove(removeStart, first.start);
					ms.remove(first.end, second.start);
					ms.remove(second.end, closeParen + 1);
				} else if (indexVarRange) {
					ms.remove(removeStart, indexVarRange.start);
					ms.remove(indexVarRange.end, closeParen + 1);
				} else if (keyExprRange) {
					ms.remove(removeStart, keyExprRange.start);
					ms.remove(keyExprRange.end, closeParen + 1);
				}
				ms.appendLeft(closeParen + 1, ')');

				// Inject clauses into body using move()
				let bodyStart = closeParen + 1;
				while (bodyStart < end && /\s/.test(source[bodyStart])) bodyStart++;

				const clauses: ForClauseInfo = { indexVar: indexVarRange, keyExpr: keyExprRange };
				if (source[bodyStart] === '{') {
					injectForClausesAtBody(ms, clauses, bodyStart + 1, false, true);
				} else if (source[bodyStart] === '(') {
					// Paren body: wrap in block and inject clauses with return
					const bodyCloseParen = findMatchingParen(source, bodyStart);
					if (bodyCloseParen !== -1) {
						ms.appendLeft(bodyStart, '{ ');
						ms.prependLeft(bodyCloseParen + 1, ' }');
					}
					injectForClausesAtBody(ms, clauses, bodyStart, true);
				}
			}

			pos = closeParen + 1;
			continue;
		}
		pos++;
	}
}

/**
 * Move for-clause ranges into the for-body using ms.move() for source-map preservation.
 */
function injectForClausesAtBody(ms: MagicString, clauses: ForClauseInfo, target: number, trailingReturn = false, leadingSpace = false): void {
	const returnStr = trailingReturn ? 'return ' : '';
	if (leadingSpace) ms.appendLeft(target, ' ');

	if (clauses.indexVar) {
		ms.move(clauses.indexVar.start, clauses.indexVar.end, target);
		ms.appendLeft(target, 'let ');
		const indexSuffix = clauses.keyExpr ? ' = 0; ' : (returnStr ? ` = 0; ${returnStr}` : ' = 0;');
		ms.appendLeft(clauses.indexVar.end, indexSuffix);
	}
	if (clauses.keyExpr) {
		ms.move(clauses.keyExpr.start, clauses.keyExpr.end, target);
		ms.appendLeft(clauses.keyExpr.end, returnStr ? `; ${returnStr}` : ';');
	}
}

/**
 * Rewrite paren-body control flow to block-body with return.
 */
function rewriteParenBodies(ms: MagicString, source: string, start: number, end: number): void {
	let pos = start;

	function wrapParenBody(): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		const closeBody = findMatchingParen(source, pos);
		if (closeBody === -1 || closeBody > end) return false;
		ms.appendLeft(pos, '{ return ');
		ms.prependLeft(closeBody + 1, '}');
		pos = closeBody + 1;
		return true;
	}

	function skipParens(): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		const close = findMatchingParen(source, pos);
		if (close === -1 || close >= end) return false;
		pos = close + 1;
		return true;
	}

	function skipWs(): void {
		while (pos < end && /\s/.test(source[pos])) pos++;
	}

	function handleBody(): boolean {
		skipWs();
		if (pos >= end) return false;
		if (source[pos] === '(') return wrapParenBody();
		if (source[pos] === '{') {
			const closeBlock = findMatchingBrace(source, pos);
			if (closeBlock !== -1) {
				rewriteParenBodies(ms, source, pos + 1, closeBlock);
				pos = closeBlock + 1;
				return true;
			}
		}
		return false;
	}

	while (pos < end) {
		skipWs();
		if (pos >= end) break;

		const slice = source.slice(pos, pos + 10);

		if (/^(if|for|while)\s*[\s(]/.test(slice)) {
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			// For for-loops with ; index/key clauses, stripForClauses already handled the body
			if (/^for\s/.test(slice)) {
				const headerClose = findMatchingParen(source, pos);
				if (headerClose === -1 || headerClose >= end) break;
				const header = source.slice(pos + 1, headerClose);
				if (/;\s*(index|key)\s+/.test(header)) {
					pos = headerClose + 1;
					skipWs();
					if (source[pos] === '{') {
						pos++;
					} else if (source[pos] === '(') {
						const cp = findMatchingParen(source, pos);
						if (cp !== -1) pos = cp + 1;
					}
					continue;
				}
			}
			if (!skipParens()) break;
			if (!handleBody()) break;
		} else if (/^else/.test(slice)) {
			pos += 4;
			skipWs();
			if (pos >= end) break;
			if (/^if\s*\(/.test(source.slice(pos, pos + 10))) continue;
			if (!handleBody()) break;
		} else if (/^try/.test(slice)) {
			pos += 3;
			if (!handleBody()) break;
		} else if (/^catch/.test(slice)) {
			pos += 5;
			skipWs();
			skipParens();
			if (!handleBody()) break;
		} else if (/^pending/.test(slice)) {
			pos += 7;
			if (!handleBody()) break;
		} else if (/^switch/.test(slice)) {
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			if (!skipParens()) break;
			skipWs();
			if (source[pos] === '{') {
				const closeBlock = findMatchingBrace(source, pos);
				if (closeBlock !== -1) { pos = closeBlock + 1; } else break;
			} else break;
		} else {
			break;
		}
	}
}

function skipLineComment(code: string, start: number): number {
	let i = start + 2;
	while (i < code.length && code[i] !== '\n') i++;
	return i;
}

function skipBlockComment(code: string, start: number): number {
	let i = start + 2;
	while (i < code.length - 1) {
		if (code[i] === '*' && code[i + 1] === '/') return i + 2;
		i++;
	}
	return code.length;
}

function findMatchingBrace(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '{') depth++;
		else if (ch === '}') { depth--; if (depth === 0) return i; }
		else if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(code, i);
			continue;
		}
		i++;
	}
	return -1;
}

// ── JSX attribute transforms (tag-scoped) ─────────────────────────

/**
 * Single-pass transform for all JSX attribute operations:
 * - `bind:{x}` → `bind:x={x}` (shorthand expansion for TS parser)
 * - `attr={count += 1}` → `attr={() => count += 1}` (assignment/update wrapping)
 *
 * Finds JSX opening tags, then processes attributes within each.
 */
function transformJsxAttributes(ms: MagicString, source: string): void {
	const tagRe = /<([A-Za-z_][\w.]*)(?=[\s/>])/g;
	let tagMatch;
	while ((tagMatch = tagRe.exec(source)) !== null) {
		const attrStart = tagMatch.index + tagMatch[0].length;
		const tagClose = findJsxTagClose(source, attrStart);
		if (tagClose === -1) continue;

		// bind:{x} → bind:value={x}  (shorthand expansion — TS can't parse `:{`)
		const bindShortRe = /bind:\{(\w+)\}/g;
		bindShortRe.lastIndex = attrStart;
		let m;
		while ((m = bindShortRe.exec(source)) !== null && m.index < tagClose) {
			ms.overwrite(m.index, m.index + m[0].length, `bind:${m[1]}={${m[1]}}`);
		}

		// Wrap assignment/update expressions: attr={x += 1} → attr={() => x += 1}
		const attrRe = /\b[a-zA-Z][\w-]*\s*=\s*\{/g;
		attrRe.lastIndex = attrStart;
		let attrMatch;
		while ((attrMatch = attrRe.exec(source)) !== null && attrMatch.index < tagClose) {
			const braceStart = source.indexOf('{', attrMatch.index + 2);
			if (braceStart === -1 || braceStart >= tagClose) continue;
			const braceEnd = findMatchingBrace(source, braceStart);
			if (braceEnd === -1) continue;

			const inner = source.slice(braceStart + 1, braceEnd).trim();
			if (!needsWrapping(inner)) continue;

			ms.appendLeft(braceStart + 1, '() => ');
		}
	}
}

/** Find the closing `>` or `/>` of a JSX opening tag, skipping over attribute values. */
function findJsxTagClose(source: string, start: number): number {
	let i = start;
	while (i < source.length) {
		const ch = source[i];
		if (ch === '>' || (ch === '/' && source[i + 1] === '>')) return i;
		if (ch === '{') {
			const close = findMatchingBrace(source, i);
			if (close === -1) return -1;
			i = close + 1;
			continue;
		}
		if (ch === '"' || ch === "'") {
			i = skipString(source, i);
			continue;
		}
		if (ch === '<') return -1;
		i++;
	}
	return -1;
}

/** Bare assignment/update that isn't already a function needs an arrow wrapper */
function needsWrapping(expr: string): boolean {
	if (/^(\(.*\)\s*=>|[a-zA-Z_$]\w*\s*=>|function[\s(])/.test(expr)) return false;
	const stripped = expr.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
	if (/\+\+|--/.test(stripped)) return true;
	return /(?<![<>!=])=(?![=>])/.test(stripped);
}

// ── Helpers ────────────────────────────────────────────────────────

function findMatchingParen(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(code, i);
			continue;
		}
		if (depth > 0) i++;
	}
	return depth === 0 ? i : -1;
}

// ── <style> block blanking ─────────────────────────────────────────

function blankStyleBlocks(ms: MagicString, source: string): void {
	const openTag = /<style\b[^>]*>/gi;
	const interpRe = /\{[a-zA-Z_$][a-zA-Z0-9_$.]*\}/g;
	let match;
	while ((match = openTag.exec(source)) !== null) {
		const contentStart = match.index + match[0].length;
		const closeIdx = source.indexOf('</style>', contentStart);
		if (closeIdx === -1) continue;

		// Blank CSS but preserve {expr} interpolations (valid JSX expressions)
		interpRe.lastIndex = contentStart;
		let pos = contentStart;
		let m;
		while ((m = interpRe.exec(source)) !== null && m.index < closeIdx) {
			if (pos < m.index) blankRange(ms, source, pos, m.index);
			pos = m.index + m[0].length;
		}
		if (pos < closeIdx) blankRange(ms, source, pos, closeIdx);
	}
}

function blankRange(ms: MagicString, source: string, start: number, end: number): void {
	let blanked = '';
	for (let i = start; i < end; i++) {
		blanked += source[i] === '\n' ? '\n' : ' ';
	}
	ms.overwrite(start, end, blanked);
}

// ── Suppress zone detection ────────────────────────────────────────

export interface SuppressZone {
	start: number;
	end: number;
}

/**
 * Find regions in DarTsx source where certain TS errors are expected false
 * positives and should be suppressed:
 * - Control flow blocks in JSX (`{if/for/switch/try ...}` inside render blocks)
 * - `bind:` attribute spans
 */
export function findSuppressZones(source: string): SuppressZone[] {
	const zones: SuppressZone[] = [];

	// 1. Control flow in JSX inside render(...) blocks
	const renderRe = /\brender\s*\(/g;
	let match;
	while ((match = renderRe.exec(source)) !== null) {
		const openParen = match.index + match[0].length - 1;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;
		collectControlFlowZones(source, openParen + 1, closeParen, zones);
	}

	// 2. bind: attributes (bind:prop={expr} and bind:{x} shorthand)
	const bindRe = /\bbind:/g;
	while ((match = bindRe.exec(source)) !== null) {
		const attrStart = match.index;
		let end = attrStart + match[0].length;
		if (end < source.length && source[end] === '{') {
			// bind:{x} shorthand
			const closeBrace = findMatchingBrace(source, end);
			end = closeBrace !== -1 ? closeBrace + 1 : end + 1;
		} else {
			// bind:propName or bind:propName={expr}
			while (end < source.length && /[\w-]/.test(source[end])) end++;
			if (end < source.length && source[end] === '=' && end + 1 < source.length && source[end + 1] === '{') {
				const closeBrace = findMatchingBrace(source, end + 1);
				end = closeBrace !== -1 ? closeBrace + 1 : end + 1;
			}
		}
		zones.push({ start: attrStart, end });
	}

	return zones;
}

function collectControlFlowZones(
	source: string, start: number, end: number, zones: SuppressZone[],
): void {
	let i = start;
	while (i < end) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(source, i);
			continue;
		}
		if (ch === '{') {
			const closeBrace = findMatchingBrace(source, i);
			if (closeBrace === -1 || closeBrace > end) { i++; continue; }

			let j = i + 1;
			while (j < closeBrace && /\s/.test(source[j])) j++;
			const kw = source.slice(j, j + 10);

			if (/^if\s*[\s(]/.test(kw) || /^for\s*[\s(]/.test(kw) ||
				/^switch\s*\(/.test(kw) || /^try[\s({<]/.test(kw)) {
				zones.push({ start: i, end: closeBrace + 1 });
			}
			// Recurse into nested content
			collectControlFlowZones(source, i + 1, closeBrace, zones);
			i = closeBrace + 1;
			continue;
		}
		i++;
	}
}
