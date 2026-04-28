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
 *   - `bind:value={x}` → `__bind_value={x}`
 *   - `bind:{x}` → `__bind_value={x}`
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
 * Only checks the first 4KB for performance.
 */
export function isDarTsxFile(content: string): boolean {
	const sample = content.slice(0, 4096);
	return /\bcomponent\s+\w+\s*\(/.test(sample)
		|| /\bstate\s+\w+/.test(sample)
		|| /\bderived\s+\w+/.test(sample)
		|| /\bderived\s+[{[]/.test(sample)
		|| /\brender\s*[(<]/.test(sample)
		|| /<[^>]*\bbind:(?:\{[a-zA-Z_]\w*\}|[a-zA-Z][\w-]*)\b/.test(sample);
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
	transformRenderBlocks(ms, source);
	transformJsxControlFlow(ms, source);
	transformHtmlDirective(ms, source);
	transformBindShorthand(ms, source);
	transformBindAttributes(ms, source);
	blankStyleBlocks(ms, source);

	const code = ms.toString();
	const map = ms.generateMap({ hires: 'boundary' });
	return { code, map };
}

// ── Comment detection ──────────────────────────────────────────────

type CommentRange = { start: number; end: number };

function buildCommentRanges(source: string): CommentRange[] {
	const ranges: CommentRange[] = [];
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
			i = skipString(source, i);
		} else {
			i++;
		}
	}
	return ranges;
}

function isInComment(ranges: CommentRange[], pos: number): boolean {
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

function transformComponentDeclarations(ms: MagicString, source: string, commentRanges: CommentRange[]): void {
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

		// Build destructuring prefix: ({name, ...rest}: {
		const destructParts: string[] = [];
		for (const p of parsed) {
			if (p.isRest) {
				destructParts.push(`...${p.localName}`);
			} else {
				const key = p.externalName !== null ? `'${p.externalName}'` : null;
				const base = key ? `${key}: ${p.localName}` : p.localName;
				destructParts.push(p.defaultValue ? `${base} = ${p.defaultValue}` : base);
			}
		}

		// Replace ( with ({destructuring}: {  — keeps original params at their positions
		ms.overwrite(openParen, openParen + 1, `({${destructParts.join(', ')}}: {`);
		// Replace ) with })
		ms.overwrite(closeParen, closeParen + 1, '})');

		// Edit each param IN PLACE to become its type annotation entry
		for (let i = 0; i < paramRanges.length; i++) {
			editParamForType(ms, source, paramRanges[i], parsed[i]);
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
 * Edit a param range in place so the original tokens become the type annotation entry.
 * e.g. `bind 'ext' as name: string = 'x'` → `'ext'?: string`
 * Preserves original character positions for correct source map hover.
 */
function editParamForType(
	ms: MagicString, source: string, range: ParamRange, param: ParsedParam,
): void {
	const raw = range.text;
	const leadingWs = raw.match(/^\s*/)![0].length;
	const contentStart = range.start + leadingWs;

	// Rest params → index signature
	if (param.isRest) {
		ms.overwrite(contentStart, range.end, '[key: string]: any');
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

	// Handle renamed params: remove ` as localName[?]`, keep ext name
	if (param.externalName !== null) {
		const quote = source[cursor];
		const closeQuote = source.indexOf(quote, cursor + 1);
		if (closeQuote > 0) {
			const afterQuote = closeQuote + 1;
			const asMatch = source.slice(afterQuote, range.end).match(/^\s+as\s+\w+\??/);
			if (asMatch) {
				ms.remove(afterQuote, afterQuote + asMatch[0].length);
			}
			// Insert ? if optional/has default
			if (param.isOptional || param.defaultValue !== null) {
				ms.appendLeft(afterQuote, '?');
			}
			// If no type, add `: any`
			if (param.type === null) {
				ms.appendLeft(afterQuote, ': any');
			}
		}
	} else {
		// Simple param: name[?]: Type [= default]
		const nameEnd = cursor + param.localName.length;
		if (param.isOptional || param.defaultValue !== null) {
			if (source[nameEnd] !== '?') {
				ms.appendLeft(nameEnd, '?');
			}
		}
		// If no type, add `: any`
		if (param.type === null) {
			const insertPos = source[nameEnd] === '?' ? nameEnd + 1 : nameEnd;
			ms.appendLeft(insertPos, ': any');
		}
	}

	// Remove default value: ` = val`
	if (param.defaultValue !== null) {
		const eqPos = findDefaultEqualsPos(source, contentStart, range.end);
		if (eqPos >= 0) {
			// Include preceding whitespace
			let removeStart = eqPos;
			while (removeStart > contentStart && source[removeStart - 1] === ' ') removeStart--;
			ms.remove(removeStart, range.end);
		}
	}
}

/** Find the last `=` at depth 0 in [start, end), skipping `=>` and `==` */
function findDefaultEqualsPos(source: string, start: number, end: number): number {
	let eqPos = -1;
	let depth = 0;
	for (let i = start; i < end; i++) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(source, i) - 1;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === '=' && depth === 0 && source[i + 1] !== '>' && source[i + 1] !== '=') {
			eqPos = i;
		}
	}
	return eqPos;
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

/** Find `=` at depth 0, skipping `=>` and `==` */
function findDefaultEquals(s: string): number {
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(s, i) - 1;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === '=' && depth === 0 && s[i + 1] !== '>' && s[i + 1] !== '=') return i;
	}
	return -1;
}



// ── state x = → let x = ───────────────────────────────────────────

function transformStateDeclarations(ms: MagicString, source: string, commentRanges: CommentRange[]): void {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate(\s+\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const stateStart = match.index + (match[1]?.length ?? 0);
		const stateEnd = stateStart + 'state'.length;
		ms.overwrite(stateStart, stateEnd, 'let');
	}
}

// ── derived x = → const x = ───────────────────────────────────────

function transformDerivedDeclarations(ms: MagicString, source: string, commentRanges: CommentRange[]): void {
	// Simple: derived varName = expr
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(\s+\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const derivedStart = match.index + (match[1]?.length ?? 0);
		const derivedEnd = derivedStart + 'derived'.length;
		ms.overwrite(derivedStart, derivedEnd, 'const');
	}

	// Destructuring: derived { ... } = expr  or  derived [ ... ] = expr
	// Only the keyword needs rewriting here; TS can parse the rest natively.
	const reDestructure = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[{[])/g;
	while ((match = reDestructure.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const derivedStart = match.index + (match[1]?.length ?? 0);
		const derivedEnd = derivedStart + 'derived'.length;
		ms.overwrite(derivedStart, derivedEnd, 'const');
	}
}

// ── render (...) → return (<>...</>) ───────────────────────────────

function transformRenderBlocks(ms: MagicString, source: string): void {
	// render (...) → return (<>...</>)
	const re = /\brender\s*\(/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const renderStart = match.index;
		const openParen = renderStart + match[0].length - 1;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;

		// render( → return(<>
		ms.overwrite(renderStart, openParen, 'return ');
		ms.appendLeft(openParen + 1, '<>');

		// ) → </>)
		ms.appendLeft(closeParen, '</>');
	}

	// render <JSX> → return <JSX> (inline render without parentheses)
	const reInline = /\brender(\s+)(?=<)/g;
	while ((match = reInline.exec(source)) !== null) {
		ms.overwrite(match.index, match.index + 'render'.length, 'return');
	}

	// render <expression>; → return <expression>; (bare expression, not parens or JSX)
	const reExpr = /\brender(\s+)(?![(<])/g;
	while ((match = reExpr.exec(source)) !== null) {
		ms.overwrite(match.index, match.index + 'render'.length, 'return');
	}
}

// ── JSX control flow → IIFE ────────────────────────────────────────

/**
 * Wraps control flow blocks inside JSX in IIFEs so TypeScript can
 * type-check them. `{if (x) { return <div/> }}` → `{(() => { if (x) { return <div/> } })()}`
 */
function transformJsxControlFlow(ms: MagicString, source: string): void {
	const re = /\brender\s*\(/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const openParen = match.index + match[0].length - 1;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;
		wrapControlFlowBlocks(ms, source, openParen + 1, closeParen);
	}
}

function wrapControlFlowBlocks(ms: MagicString, source: string, start: number, end: number): void {
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

			// Check if this brace contains a control flow keyword at the top level
			let j = i + 1;
			while (j < closeBrace && /\s/.test(source[j])) j++;
			const kw = source.slice(j, j + 10);

			if (/^if\s*\(/.test(kw) || /^for\s*[\s(]/.test(kw) || /^switch\s*\(/.test(kw) || /^try\s*\{/.test(kw)) {
				ms.appendLeft(i + 1, '(() => { ');
				ms.appendLeft(closeBrace, ' })()');
				// Recurse inside to handle nested control flow in JSX
				wrapControlFlowBlocks(ms, source, i + 1, closeBrace);
			}

			i = closeBrace + 1;
			continue;
		}
		i++;
	}
}

function findMatchingBrace(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '{') depth++;
		else if (ch === '}') { depth--; if (depth === 0) return i; }
		else if (ch === "'" || ch === '"') {
			i = skipString(code, i);
			continue;
		} else if (ch === '`') {
			i = skipTemplateLiteral(code, i);
			continue;
		}
		i++;
	}
	return -1;
}

// ── bind:{x} → __bind_value={x} ───────────────────────────────────

function transformBindShorthand(ms: MagicString, source: string): void {
	const re = /bind:\{(\w+)\}/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		ms.overwrite(match.index, match.index + match[0].length, `__bind_value={${match[1]}}`);
	}
}

// ── bind:prop={x} → __bind_prop={x} ───────────────────────────────

function transformBindAttributes(ms: MagicString, source: string): void {
	const re = /bind:([a-zA-Z][\w-]*)(\s*=)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const bindStart = match.index;
		const bindEnd = bindStart + 'bind:'.length + match[1].length;
		ms.overwrite(bindStart, bindEnd, `__bind_${match[1]}`);
	}
}

// ── Helpers ────────────────────────────────────────────────────────

function findMatchingParen(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === "'" || ch === '"') {
			i = skipString(code, i);
			continue;
		} else if (ch === '`') {
			i = skipTemplateLiteral(code, i);
			continue;
		}
		if (depth > 0) i++;
	}
	return depth === 0 ? i : -1;
}

function skipTemplateLiteral(code: string, start: number): number {
	let i = start + 1;
	while (i < code.length) {
		if (code[i] === '\\') { i += 2; continue; }
		if (code[i] === '`') return i + 1;
		if (code[i] === '$' && code[i + 1] === '{') {
			i += 2;
			let depth = 1;
			while (i < code.length && depth > 0) {
				if (code[i] === '{') depth++;
				else if (code[i] === '}') depth--;
				i++;
			}
			continue;
		}
		i++;
	}
	return i;
}

// ── {@html expr} → {expr} ─────────────────────────────────────────

function transformHtmlDirective(ms: MagicString, source: string): void {
	// {@html expr} → {expr} — strip the @html directive for type-checking
	const re = /\{@html\s+/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const start = match.index + 1; // after '{'
		const end = start + match[0].length - 1; // up to end of '@html '
		ms.overwrite(start, end, '');
	}
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
		if (ch === "'" || ch === '"') {
			i = skipString(source, i);
			continue;
		}
		if (ch === '`') {
			i = skipTemplateLiteral(source, i);
			continue;
		}
		if (ch === '{') {
			const closeBrace = findMatchingBrace(source, i);
			if (closeBrace === -1 || closeBrace > end) { i++; continue; }

			let j = i + 1;
			while (j < closeBrace && /\s/.test(source[j])) j++;
			const kw = source.slice(j, j + 10);

			if (/^if\s*[\s(]/.test(kw) || /^for\s*[\s(]/.test(kw) ||
				/^switch\s*\(/.test(kw) || /^try\s*\{/.test(kw)) {
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
