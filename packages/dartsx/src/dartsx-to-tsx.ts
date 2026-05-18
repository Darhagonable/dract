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
	transformRenderBlocks(ms, source);
	transformJsxControlFlow(ms, source);
	transformEventHandlers(ms, source);
	transformHtmlDirective(ms, source);
	transformBindShorthand(ms, source);
	transformBindAttributes(ms, source);
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

	// render <expr> or render <JSX> → return ...
	const reOther = /\brender(\s+)(?!\()/g;
	while ((match = reOther.exec(source)) !== null) {
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
	const processed: { start: number; end: number }[] = [];
	let match;
	while ((match = re.exec(source)) !== null) {
		const openParen = match.index + match[0].length - 1;
		// Skip inner render blocks nested inside an already-processed outer render
		if (processed.some(r => match!.index > r.start && match!.index < r.end)) continue;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;
		processed.push({ start: openParen, end: closeParen });
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

			if (/^if\s*\(/.test(kw) || /^for\s*[\s(]/.test(kw) || /^switch\s*\(/.test(kw) || /^try[\s({<]/.test(kw)) {
				ms.appendLeft(i + 1, '(() => { ');
				ms.appendLeft(closeBrace, ' })()');
				// For for-loops, strip `; index <var>` and `; key <expr>` clauses
				let keyExprRange: KeyExprRange | null = null;
				if (/^for\s*[\s(]/.test(kw)) {
					keyExprRange = stripForClauses(ms, source, j, closeBrace);
				}
				// Rewrite paren-body control flow to block-body with return
				rewriteParenBodies(ms, source, j, closeBrace, keyExprRange);
			}
			// Always recurse into brace blocks to find nested control flow
			wrapControlFlowBlocks(ms, source, i + 1, closeBrace);

			i = closeBrace + 1;
			continue;
		}
		i++;
	}
}

/**
 * Strip `; index <var>` and `; key <expr>` clauses from for-loop headers.
 * `for (const x of items; index i; key x.id)` → `let i = 0; for (const x of items) { x.id; ...}`
 * Uses ms.move() to preserve source mapping for the index variable.
 * Moves the key expression into the for-body as a statement for type-checking.
 */
interface KeyExprRange {
	start: number;
	end: number;
}

function stripForClauses(ms: MagicString, source: string, forStart: number, end: number): KeyExprRange | null {
	// Find the opening paren of the for-loop
	let pos = forStart + 3; // skip 'for'
	while (pos < end && /\s/.test(source[pos])) pos++;
	if (source[pos] !== '(') return null;
	const openParen = pos;
	const closeParen = findMatchingParen(source, openParen);
	if (closeParen === -1 || closeParen > end) return null;

	// Look for `; index <var>` and `; key <expr>` within the for parens
	const header = source.slice(openParen + 1, closeParen);
	const clauseRe = /;\s*(index|key)\s+/g;
	let firstClauseIdx = -1;
	let indexVarStart = -1;
	let indexVarEnd = -1;
	let keyExprStart = -1;
	let keyExprEnd = -1;
	let clauseMatch;

	while ((clauseMatch = clauseRe.exec(header)) !== null) {
		if (firstClauseIdx === -1) firstClauseIdx = clauseMatch.index;
		const afterKw = clauseMatch.index + clauseMatch[0].length;
		if (clauseMatch[1] === 'index') {
			const varMatch = header.slice(afterKw).match(/^([A-Za-z_$][\w$]*)/);
			if (varMatch) {
				indexVarStart = openParen + 1 + afterKw;
				indexVarEnd = indexVarStart + varMatch[1].length;
			}
		} else if (clauseMatch[1] === 'key') {
			// Key expression runs from after "key " to the next ";" or end of header
			keyExprStart = openParen + 1 + afterKw;
			const nextSemi = header.indexOf(';', afterKw);
			keyExprEnd = nextSemi !== -1 ? openParen + 1 + nextSemi : closeParen;
			// Trim trailing whitespace
			while (keyExprEnd > keyExprStart && /\s/.test(source[keyExprEnd - 1])) keyExprEnd--;
		}
	}

	if (firstClauseIdx === -1) return null;

	const removeStart = openParen + 1 + firstClauseIdx;
	const hasKey = keyExprStart !== -1 && keyExprEnd > keyExprStart;

	if (indexVarStart !== -1) {
		// Move the index variable to before `for`, preserving its source mapping.
		ms.move(indexVarStart, indexVarEnd, forStart);
		ms.appendLeft(forStart, 'let ');
		ms.appendLeft(indexVarEnd, ' = 0; ');

		if (hasKey) {
			// Remove clause text but keep key expression range intact for later move()
			if (indexVarStart < keyExprStart) {
				// Order: ; index i; key item.id
				ms.remove(removeStart, indexVarStart);
				ms.remove(indexVarEnd, keyExprStart);
				ms.remove(keyExprEnd, closeParen);
			} else {
				// Order: ; key item.id; index i
				ms.remove(removeStart, keyExprStart);
				ms.remove(keyExprEnd, indexVarStart);
				ms.remove(indexVarEnd, closeParen);
			}
		} else {
			ms.remove(removeStart, indexVarStart);
			ms.remove(indexVarEnd, closeParen);
		}
		ms.overwrite(closeParen, closeParen + 1, ')');
	} else if (hasKey) {
		// No index variable, just key — remove surrounding text, keep key range
		ms.remove(removeStart, keyExprStart);
		ms.remove(keyExprEnd, closeParen);
		ms.overwrite(closeParen, closeParen + 1, ')');
	} else {
		// No index, no key — just strip clauses
		ms.overwrite(removeStart, closeParen, ')');
		ms.remove(closeParen, closeParen + 1);
	}

	return hasKey ? { start: keyExprStart, end: keyExprEnd } : null;
}

/**
 * Rewrite paren-body control flow to block-body with return so TS can type-check.
 * Handles: if/for/while/else/try/catch/pending with paren bodies.
 */
function rewriteParenBodies(ms: MagicString, source: string, start: number, end: number, keyExprRange?: KeyExprRange | null): void {
	let pos = start;
	let isFirst = true;

	/** Wrap a paren body `( ... )` → `{ return ( ... ) }` at current pos */
	function wrapParenBody(prefix = '{ return '): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		const closeBody = findMatchingParen(source, pos);
		if (closeBody === -1 || closeBody > end) return false;
		ms.appendLeft(pos, prefix);
		ms.prependLeft(closeBody + 1, ' }');
		pos = closeBody + 1;
		return true;
	}

	/** Skip `(...)` condition/params */
	function skipParens(): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		const close = findMatchingParen(source, pos);
		if (close === -1 || close >= end) return false;
		pos = close + 1;
		return true;
	}

	/** Skip whitespace */
	function skipWs(): void {
		while (pos < end && /\s/.test(source[pos])) pos++;
	}

	/** Skip or wrap the body (block body skipped, paren body wrapped) */
	function handleBody(prefix = '{ return '): boolean {
		skipWs();
		if (pos >= end) return false;
		if (source[pos] === '(') return wrapParenBody(prefix);
		if (source[pos] === '{') {
			const closeBlock = findMatchingBrace(source, pos);
			if (closeBlock !== -1) { pos = closeBlock + 1; return true; }
		}
		return false;
	}

	while (pos < end) {
		skipWs();
		if (pos >= end) break;

		const slice = source.slice(pos, pos + 10);

		if (/^(if|for|while)\s*[\s(]/.test(slice)) {
			const isFor = /^for\s/.test(slice);
			// Skip keyword to opening paren
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			if (!skipParens()) break;
			// Handle body
			skipWs();
			if (pos >= end) break;
			if (isFor && isFirst && keyExprRange && source[pos] === '(') {
				// For-loop with key: inject key expression before return
				wrapParenBody('{ ');
				// move() was already done by stripForClauses; just append the separator
				ms.move(keyExprRange.start, keyExprRange.end, pos);
				ms.appendLeft(keyExprRange.end, '; return ');
			} else if (!handleBody()) break;
			isFirst = false;
		} else if (/^else/.test(slice)) {
			pos += 4; // skip 'else'
			skipWs();
			if (pos >= end) break;
			if (/^if\s*\(/.test(source.slice(pos, pos + 10))) continue; // else if → loop handles it
			if (!handleBody()) break;
		} else if (/^try/.test(slice)) {
			pos += 3; // skip 'try'
			if (!handleBody()) break;
		} else if (/^catch/.test(slice)) {
			pos += 5; // skip 'catch'
			skipWs();
			skipParens(); // skip (e)
			if (!handleBody()) break;
		} else if (/^pending/.test(slice)) {
			pos += 7; // skip 'pending'
			if (!handleBody()) break;
		} else {
			break;
		}
	}
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

// ── Assignment/update wrapping ─────────────────────────────────────

/**
 * Wrap assignment/update expressions in JSX attributes with arrow functions.
 * `onclick={count += 1}` → `onclick={() => count += 1}`
 * `onclick={count++}` → `onclick={() => count++}`
 *
 * Only wraps expressions that are clearly statement-like (assignments, ++, --).
 * Applies to all props, not just event handlers.
 */
function transformEventHandlers(ms: MagicString, source: string): void {
	const re = /\b[a-zA-Z][\w-]*\s*=\s*\{/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		// Only apply inside JSX opening tags (not variable declarations/object literals)
		if (!isJsxAttributeContext(source, match.index)) continue;

		const braceStart = source.indexOf('{', match.index + 2);
		if (braceStart === -1) continue;
		const braceEnd = findMatchingBrace(source, braceStart);
		if (braceEnd === -1) continue;

		const inner = source.slice(braceStart + 1, braceEnd).trim();
		if (!needsWrapping(inner)) continue;

		// Wrap: {expr} → {() => expr}
		ms.appendLeft(braceStart + 1, '() => ');
	}
}

/** Check if pos is inside a JSX opening tag's attribute list (between `<Tag` and `>`) */
function isJsxAttributeContext(source: string, pos: number): boolean {
	for (let i = pos - 1; i >= 0; i--) {
		const ch = source[i];
		if (ch === '<') return true;
		if (ch === '>' || ch === ';' || ch === '{') return false;
		// Skip over brace-delimited prop values (scan matching { backwards)
		if (ch === '}') {
			let depth = 1;
			i--;
			while (i >= 0 && depth > 0) {
				if (source[i] === '}') depth++;
				else if (source[i] === '{') depth--;
				i--;
			}
			continue;
		}
		// Skip over string prop values
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i--;
			while (i >= 0 && source[i] !== quote) {
				if (i > 0 && source[i - 1] === '\\') i--;
				i--;
			}
			continue;
		}
	}
	return false;
}

/** Bare assignment/update that isn't already a function needs an arrow wrapper */
function needsWrapping(expr: string): boolean {
	if (/^(\(.*\)\s*=>|[a-zA-Z_$]\w*\s*=>|function[\s(])/.test(expr)) return false;
	// Strip string literals so operators inside strings (e.g. CSS `--var`) don't trigger false positives
	const stripped = expr.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
	if (/\+\+|--/.test(stripped)) return true;
	return /(?<![<>!=])=(?![=>])/.test(stripped);
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
		else if (ch === "'" || ch === '"' || ch === '`') {
			i = skipString(code, i);
			continue;
		}
		if (depth > 0) i++;
	}
	return depth === 0 ? i : -1;
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
