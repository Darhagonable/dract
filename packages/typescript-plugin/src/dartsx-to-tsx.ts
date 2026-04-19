/**
 * DarTsx → TSX Transform
 *
 * Transforms DarTsx custom syntax into valid TypeScript/TSX that the
 * TypeScript language service can understand. Uses MagicString for
 * surgical text manipulation with automatic source map generation.
 *
 * Transforms:
 *   - `component Name(` → `function Name(`
 *   - `state x =` → `let x =`
 *   - `derived x =` → `const x =`
 *   - `render (...)` → `return (<>...</>)`
 *   - `bind:value={x}` → `__bind_value={x}`
 *   - `bind:{x}` → `__bind_value={x}`
 *   - `bind paramName` → `paramName` (in function params)
 *   - `onclick={expr}` → `onclick={() => {expr}}` (bare expressions)
 *   - Control flow: left as-is (suppressed via diagnostics)
 */

import MagicString from 'magic-string';

export interface TransformResult {
	/** The transformed valid TSX code */
	code: string;
	/** MagicString instance (for generating source maps) */
	ms: MagicString;
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
	transformRenamedParams(ms, source);
	transformBindInParams(ms, source);
	transformStateDeclarations(ms, source, commentRanges);
	transformDerivedDeclarations(ms, source, commentRanges);
	transformRenderBlocks(ms, source);
	transformJsxControlFlow(ms, source);
	transformBindShorthand(ms, source);
	transformBindAttributes(ms, source);
	blankStyleBlocks(ms, source);

	return { code: ms.toString(), ms };
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

// ── component → function ───────────────────────────────────────────

function transformComponentDeclarations(ms: MagicString, source: string, commentRanges: CommentRange[]): void {
	const re = /\b((?:export\s+)?(?:default\s+)?(?:async\s+)?)component(\s+\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const prefixEnd = match.index + match[1].length;
		const componentStart = prefixEnd;
		const componentEnd = componentStart + 'component'.length;
		ms.overwrite(componentStart, componentEnd, 'function');
	}
}



// ── 'ext-name' as localName → localName ───────────────────────────

function transformRenamedParams(ms: MagicString, source: string): void {
	const re = /(\bbind\s+)?(['"])([^'"]+)\2\s+as\s+(\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const localName = match[4];
		const identStart = match.index + match[0].lastIndexOf(localName);
		ms.remove(match.index, identStart);
	}
}

// ── bind paramName → paramName ─────────────────────────────────────

function transformBindInParams(ms: MagicString, source: string): void {
	// Match `bind` followed by an identifier in function parameter context
	// We look for `bind` as a standalone keyword (not bind:)
	const re = /\bbind\s+(\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		// Check it's not `bind:` (attribute syntax)
		const afterBind = match.index + 4; // length of "bind"
		const nextNonSpace = source.slice(afterBind).search(/\S/);
		if (nextNonSpace >= 0 && source[afterBind + nextNonSpace] === ':') continue;

		// Remove `bind ` prefix, keep just the identifier
		const identStart = match.index + match[0].indexOf(match[1]);
		ms.remove(match.index, identStart);
	}
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
