/**
 * Phase 1 — Parse
 *
 * Pre-processes DarTsx custom syntax into valid TSX that OXC can parse,
 * then parses with OXC. Uses a single MagicString instance for all transforms
 * to produce a correct source map from preprocessed output → original source.
 */
import MagicString, { type SourceMap } from 'magic-string';
import {
	parseSync as oxcParseSync,
} from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

export interface ComponentMeta {
	name: string;
	isExport: boolean;
	isDefault: boolean;
	isAsync: boolean;
}

/** Marker identifiers used in preprocessed code to identify state/derived declarations */
export const STATE_MARKER = '$$s';
export const DERIVED_MARKER = '$$d';
/** Prefix for style block marker JSX elements (e.g. <$$style0 />) */
export const STYLE_MARKER_PREFIX = '$$style';

export interface PreprocessResult {
	/** The transformed source that OXC can parse */
	code: string;
	/** Source map from preprocessed → original */
	map: SourceMap;
	/** Components found during pre-processing */
	components: ComponentMeta[];
	/** All names ever declared with `state` (for reactive var tracking, not scoping) */
	stateVars: string[];
	/** All names ever declared with `derived` (for reactive var tracking, not scoping) */
	derivedVars: string[];
	/** Renamed params: componentName → { localName → externalName } */
	renamedParams: Record<string, Record<string, string>>;
	/** Style blocks extracted from render, keyed by component name */
	styleBlocks: ExtractedStyleBlock[];
}

export interface ExtractedStyleBlock {
	/** Raw CSS content */
	css: string;
	/** Whether this is a `<style global>` block */
	isGlobal: boolean;
	/** Marker JSX element name (e.g. '$$style0') used to locate this block in the AST */
	markerName: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Find the component that owns a given source offset ('' if module-level) */
function findOwnerComponent(componentPositions: { name: string; start: number }[], offset: number): string {
	let owner = '';
	for (const cp of componentPositions) {
		if (offset >= cp.start) owner = cp.name;
		else break;
	}
	return owner;
}

// ── Type annotation skipping ───────────────────────────────────────

/**
 * Given a position right after a variable name, skip a `: Type` annotation
 * by tracking balanced `{}`, `<>`, `()`, and `[]`. Returns the index right
 * after the type annotation ends (where `=`, `;`, newline, or EOF is).
 */
function skipTypeAnnotation(code: string, start: number): number {
	let i = start;
	while (i < code.length && (code[i] === ' ' || code[i] === '\t')) i++;
	if (i >= code.length || code[i] !== ':') return start;
	i++; // skip the `:`

	let depth = 0;

	while (i < code.length) {
		const ch = code[i];
		if (ch === '{' || ch === '(' || ch === '[') {
			depth++;
		} else if (ch === '}' || ch === ')' || ch === ']') {
			if (depth === 0) break;
			depth--;
		} else if (ch === '<') {
			depth++;
		} else if (ch === '>') {
			if (depth === 0) break;
			depth--;
		} else if (depth === 0) {
			if (ch === '=' && i + 1 < code.length && code[i + 1] !== '>') break;
			if (ch === ';' || ch === '\n') break;
		}
		i++;
	}

	return i;
}

// ── Pre-process ────────────────────────────────────────────────────

export function preprocess(source: string): PreprocessResult {
	const s = new MagicString(source);
	const components: ComponentMeta[] = [];
	const stateVars: string[] = [];
	const derivedVars: string[] = [];
	const renamedParams: Record<string, Record<string, string>> = {};
	const styleBlocks: ExtractedStyleBlock[] = [];

	// Build comment/string ranges so keyword regexes can skip matches inside them.
	const skipRanges = buildSkipRanges(source);
	function inSkipRange(offset: number): boolean {
		for (const [start, end] of skipRanges) {
			if (offset >= start && offset < end) return true;
			if (start > offset) break;
		}
		return false;
	}

	// ── 1. Component declarations ──
	// [export] [default] [async] component Name(...) → function Name({...}: {types})
	const componentRe = /\b(export\s+)?(default\s+)?(async\s+)?component\s+(\w+)/g;
	let m: RegExpExecArray | null;
	while ((m = componentRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const exportKw = m[1] || '';
		const defaultKw = m[2] || '';
		const asyncKw = m[3] || '';
		components.push({ name: m[4], isExport: !!m[1], isDefault: !!m[2], isAsync: !!m[3] });
		// Replace just the `component` keyword with `function`
		const componentStart = m.index + exportKw.length + defaultKw.length + asyncKw.length;
		const componentEnd = componentStart + 'component'.length;
		s.overwrite(componentStart, componentEnd, 'function');

		// Transform params: (params) → ({destructured}: {types})
		const openParen = source.indexOf('(', m.index + m[0].length);
		if (openParen === -1) continue;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;

		const paramRanges = splitParamRanges(source, openParen + 1, closeParen);
		if (paramRanges.length === 0) continue;
		const parsed = paramRanges.map(r => parseOneParam(r.text));

		// Build the type annotation
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

		// Replace ( → ({ and ) → }: {types})
		s.overwrite(openParen, openParen + 1, '({');
		s.overwrite(closeParen, closeParen + 1, `}: {${typeParts.join(', ')}})`);

		// Edit each param in place for destructuring
		for (let i = 0; i < paramRanges.length; i++) {
			editParamForDestructuring(s, source, paramRanges[i], parsed[i]);
		}
	}

	// Build component positions for renamed-param ownership
	const componentPositions: { name: string; start: number }[] = [];
	for (const comp of components) {
		const re = new RegExp(`\\bcomponent\\s+${comp.name}\\s*\\(`);
		const pm = source.match(re);
		if (pm && pm.index != null) {
			componentPositions.push({ name: comp.name, start: pm.index });
		}
	}
	componentPositions.sort((a, b) => a.start - b.start);

	// ── 2. Renamed params ──
	// 'ext-name' as localName → localName
	// (skip overwrite if preceded by `bind` — step 3 handles that case entirely)
	const renamedRe = /(['"])([^'"]+)\1\s+as\s+(\w+)/g;
	while ((m = renamedRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const externalName = m[2];
		const localName = m[3];
		const ownerComp = findOwnerComponent(componentPositions, m.index);
		if (ownerComp) {
			if (!renamedParams[ownerComp]) renamedParams[ownerComp] = {};
			renamedParams[ownerComp][localName] = externalName;
		}
		// Check if preceded by `bind` — if so, step 3 handles the full overwrite
		const before = source.slice(Math.max(0, m.index - 20), m.index);
		if (/\bbind\s+$/.test(before)) continue;
		s.overwrite(m.index, m.index + m[0].length, localName);
	}

	// ── 3. Bind params ──
	// bind paramName → __bind__paramName
	// bind 'ext-name' as localName → __bind__localName
	const bindParamRe = /\bbind\s+(?:(['"])([^'"]+)\1\s+as\s+)?(\w+)/g;
	while ((m = bindParamRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const localName = m[3];
		s.overwrite(m.index, m.index + m[0].length, `__bind__${localName}`);
	}

	// ── 4. State declarations ──
	// [export] state varName: Type = expr → [export] let $$sN = 0, varName: Type = expr
	let stateCounter = 0;
	const stateRe = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate\s+(\w+)/g;
	while ((m = stateRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const exportKw = m[1] || '';
		const name = m[2];
		const matchEnd = m.index + m[0].length;

		const afterType = skipTypeAnnotation(source, matchEnd);
		let peek = afterType;
		while (peek < source.length && (source[peek] === ' ' || source[peek] === '\t')) peek++;
		if (peek < source.length && !/[=;,)\n]/.test(source[peek])) continue;

		stateVars.push(name);
		const replacement = `${exportKw}let ${STATE_MARKER}${stateCounter++} = 0, ${name}`;
		s.overwrite(m.index, matchEnd, replacement);
	}

	// ── 5. Derived declarations (simple + destructuring in source order) ──
	let derivedCounter = 0;
	const derivedRe = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[\w{[])/g;
	while ((m = derivedRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const start = m.index;
		const exportKw = m[1] || '';
		const afterKeyword = start + m[0].length;
		let cursor = skipWS(source, afterKeyword);
		const nextChar = source[cursor];

		if (nextChar === '{' || nextChar === '[') {
			// Destructuring: derived { a, b } = expr → const $$dN = 0, { a, b } = expr
			const patternEnd = nextChar === '{'
				? findMatchingBrace(source, cursor)
				: findMatchingBracket(source, cursor);
			if (patternEnd === -1) continue;

			let eqCursor = skipWS(source, patternEnd + 1);
			if (source[eqCursor] !== '=') continue;

			const pattern = source.slice(cursor, patternEnd + 1);
			collectPatternIdentifiers(pattern, derivedVars);

			// Replace `[export] derived` keyword portion only
			const keywordEnd = start + exportKw.length + 'derived'.length;
			s.overwrite(start, keywordEnd, `${exportKw}const ${DERIVED_MARKER}${derivedCounter++} = 0,`);
		} else {
			// Simple: derived name: Type = expr → const $$dN = 0, name: Type = expr
			const nameMatch = source.slice(cursor).match(/^(\w+)/);
			if (!nameMatch) continue;
			const name = nameMatch[1];
			const matchEnd = cursor + name.length;

			const afterType = skipTypeAnnotation(source, matchEnd);
			let peek = afterType;
			while (peek < source.length && (source[peek] === ' ' || source[peek] === '\t')) peek++;
			if (peek < source.length && !/[=;,)\n]/.test(source[peek])) continue;

			derivedVars.push(name);
			const keywordEnd = start + exportKw.length + 'derived'.length;
			s.overwrite(start, keywordEnd, `${exportKw}const ${DERIVED_MARKER}${derivedCounter++} = 0,`);
		}
	}

	// ── 5b. Replace `pending` → `finally` (before render and IIFE handling) ──
	const editedRanges: [number, number][] = [];
	replacePendingWithFinally(source, s, 0, source.length, editedRanges);

	// ── 6. Render → return ──
	const renderRanges: [number, number][] = [];
	const renderRe = /(?<![.\w])\brender(?=[\s(<])/g;
	while ((m = renderRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		if (editedRanges.some(([s, e]) => m!.index >= s && m!.index < e)) continue;
		const renderStart = m.index;
		const renderEnd = renderStart + 'render'.length;
		let j = renderEnd;
		while (j < source.length && /[ \t]/.test(source[j])) j++;

		if (source[j] === '(') {
			const closePos = findMatchingParen(source, j);
			const inner = source.slice(j + 1, closePos);
			const trimmedInner = inner.trim();
			if (trimmedInner.startsWith('<') && !isSingleJSXRoot(trimmedInner)) {
				// Multi-root: wrap in fragment
				s.overwrite(renderStart, renderEnd, 'return');
				s.appendLeft(j + 1, '<>');
				s.prependRight(closePos, '</>');
			} else if (trimmedInner.startsWith('{')) {
				// Root-level expression block: replace {CF} with IIFE directly
				// The outer {} are DarTsx markers, not JSX expression containers
				s.overwrite(renderStart, renderEnd, 'return');
				const bracePos = j + 1 + inner.indexOf('{');
				const closeBracePos = findMatchingBrace(source, bracePos);
				s.overwrite(bracePos, bracePos + 1, '(() => {');
				s.overwrite(closeBracePos, closeBracePos + 1, '})()');
				// Process inner content (strip for clauses, rewrite paren bodies)
				stripForClauses(source, s, bracePos + 1, closeBracePos);
				rewriteParenBodies(source, s, bracePos + 1, closeBracePos, editedRanges);
				wrapMultiRootParenBodies(source, s, bracePos + 1, closeBracePos);
				// For simple expressions inside root-level block, add return
				const blockInner = source.slice(bracePos + 1, closeBracePos).trimStart();
				if (!isBlockLikeContent(blockInner)) {
					s.appendLeft(bracePos + 1, ' return ');
				}
				editedRanges.push([bracePos, bracePos + 1]);
				editedRanges.push([closeBracePos, closeBracePos + 1]);
				// Still register as render range for nested JSX expressions
				renderRanges.push([bracePos + 1, closeBracePos]);
			} else {
				s.overwrite(renderStart, renderEnd, 'return');
			}
			renderRanges.push([j + 1, closePos]);
		} else {
			// render <jsx> or render expr → return ...
			s.overwrite(renderStart, renderEnd, 'return');
		}
	}

	// ── 7. Style blocks ──
	// <style [global]>...</style> → <$$styleN />
	const styleRe = /<style(\s+global)?\s*>/g;
	while ((m = styleRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const isGlobal = !!m[1];
		const openTagEnd = m.index + m[0].length;
		const closeTag = '</style>';
		const closeIdx = source.indexOf(closeTag, openTagEnd);
		if (closeIdx === -1) continue;

		const css = source.slice(openTagEnd, closeIdx);
		const fullEnd = closeIdx + closeTag.length;
		const markerName = `${STYLE_MARKER_PREFIX}${styleBlocks.length}`;
		styleBlocks.push({ css, isGlobal, markerName });

		s.overwrite(m.index, fullEnd, `<${markerName} />`);
		editedRanges.push([m.index, fullEnd]);
	}

	// ── 8. Bind shorthand ──
	// bind:{x} → bind:x={x}
	const bindShortRe = /bind:\{(\w+)\}/g;
	while ((m = bindShortRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		s.overwrite(m.index, m.index + m[0].length, `bind:${m[1]}={${m[1]}}`);
		editedRanges.push([m.index, m.index + m[0].length]);
	}

	// ── 9. Function bindings ──
	// bind:prop={get, set} → bind:prop={[get, set]}
	const bindFnRe = /bind:\w+\s*=\s*\{/g;
	while ((m = bindFnRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		const openBrace = m.index + m[0].length - 1;
		const closeBrace = findMatchingBrace(source, openBrace);
		if (closeBrace === -1) continue;
		const inner = source.slice(openBrace + 1, closeBrace);
		if (hasTopLevelComma(inner)) {
			s.appendLeft(openBrace + 1, '[');
			s.prependRight(closeBrace, ']');
			editedRanges.push([openBrace, closeBrace + 1]);
		}
	}

	// ── 11. Wrap all JSX expressions in IIFEs ──
	wrapJSXExpressionsInIIFEs(source, s, editedRanges, renderRanges);

	const code = s.toString();
	const map = s.generateMap({ hires: true });

	return { code, map, components, stateVars, derivedVars, renamedParams, styleBlocks };
}

// ── IIFE wrapping ──────────────────────────────────────────────────

/**
 * Wrap every JSX expression `{...}` in an IIFE: `{(() => { ... })()}`
 * Also wraps multi-root paren bodies in fragments: `(a b)` → `(<>a b</>)`
 * Only operates within render block ranges.
 */
function wrapJSXExpressionsInIIFEs(source: string, s: MagicString, editedRanges: [number, number][], renderRanges: [number, number][]): void {
	function inEditedRange(pos: number): boolean {
		for (const [start, end] of editedRanges) {
			if (pos >= start && pos < end) return true;
		}
		return false;
	}

	function inRenderRange(pos: number): boolean {
		for (const [start, end] of renderRanges) {
			if (pos >= start && pos <= end) return true;
		}
		return false;
	}

	let i = 0;
	while (i < source.length) {
		if (source[i] === "'" || source[i] === '"') { i = skipString(source, i); continue; }
		if (source[i] === '`') { i = skipTemplateLiteral(source, i); continue; }
		if (source[i] === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
		if (source[i] === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }

		if (source[i] === '{') {
			if (inEditedRange(i)) { i++; continue; }
			if (inRenderRange(i)) {
				if (isJSXExpressionContext(source, i)) {
					const closeBrace = findMatchingBrace(source, i);
					if (closeBrace > i) {
						// Skip spread attributes: {...expr}
						const inner = source.slice(i + 1, closeBrace).trimStart();
						if (inner.startsWith('...')) { i = closeBrace + 1; continue; }
						// @html directive: {@html expr} → {__html(expr)}
						if (inner.startsWith('@html')) {
							const expr = inner.slice(5).trim();
							s.overwrite(i, closeBrace + 1, `{__html(${expr})}`);
							i = closeBrace + 1;
							continue;
						}
						s.appendLeft(i + 1, '(() => {');
						s.prependRight(closeBrace, '})()');
						// Strip `; index <var>` and `; key <expr>` from for-loop headers
						stripForClauses(source, s, i + 1, closeBrace);
						// Rewrite paren bodies to block bodies with return
						rewriteParenBodies(source, s, i + 1, closeBrace, editedRanges);
						// Fragment-wrap multi-root paren bodies inside this expression
						wrapMultiRootParenBodies(source, s, i + 1, closeBrace);
						// For simple expressions (not control flow), add `return`
						if (!isBlockLikeContent(inner)) {
							s.appendLeft(i + 1, ' return ');
						}
						// Continue scanning inside for nested JSX expressions
						i++;
						continue;
					}
				} else {
					// In render range but not a JSX expression.
					// Skip object literals (preceded by { or =) to avoid wrapping their contents.
					// But for control flow bodies (else, try, etc.), just advance past the brace char.
					let k = i - 1;
					while (k >= 0 && /\s/.test(source[k])) k--;
					const pc = k >= 0 ? source[k] : '';
					if (pc === '{' || pc === '=' || pc === '(') {
						const closeBrace = findMatchingBrace(source, i);
						if (closeBrace > i) { i = closeBrace + 1; continue; }
					}
				}
			}
		}
		i++;
	}
}

/**
 * Find paren bodies `(...)` inside a range that contain multiple JSX roots
 * and wrap their content in `<>...</>`.
 */
function wrapMultiRootParenBodies(source: string, s: MagicString, start: number, end: number): void {
	let i = start;
	while (i < end) {
		const ch = source[i];
		if (ch === "'" || ch === '"' || ch === '`') { i = skipString(source, i); continue; }
		if (ch === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
		if (ch === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }
		if (ch === '{') {
			const close = findMatchingBrace(source, i);
			if (close > i) {
				// Only recurse into non-JSX-expression braces (control flow bodies, etc.)
				// JSX expression braces get their own wrapMultiRootParenBodies call from the main scan
				if (!isJSXExpressionContext(source, i)) {
					wrapMultiRootParenBodies(source, s, i + 1, close);
				}
				i = close + 1;
				continue;
			}
		}
		if (ch === '(') {
			const closeParen = findMatchingParen(source, i);
			if (closeParen > i && closeParen < end) {
				const inner = source.slice(i + 1, closeParen).trim();
				if (inner.startsWith('<') && !isSingleJSXRoot(inner)) {
					s.appendLeft(i + 1, '<>');
					s.prependRight(closeParen, '</>');
				}
				// Recurse inside paren body
				wrapMultiRootParenBodies(source, s, i + 1, closeParen);
				i = closeParen + 1;
				continue;
			}
		}
		i++;
	}
}

/**
 * Strip `; index <var>` and `; key <expr>` clauses from for-loop headers.
 * Scans for `for` keyword(s) in the range and removes the custom clauses.
 * `for (const x of items; index i; key x.id)` → `for (const x of items)`
/** Handle `pending` clauses: inject `let __pending = () => {BODY}` into the try block */
function replacePendingWithFinally(source: string, s: MagicString, start: number, end: number, editedRanges?: [number, number][]): void {
	const pendingRe = /[})]\s*pending\s*[{(]/g;
	pendingRe.lastIndex = start;
	let m: RegExpExecArray | null;
	while ((m = pendingRe.exec(source)) !== null) {
		if (m.index >= end) break;
		const tryBlockClosePos = m.index; // } or ) that closes the try block
		const pendingKwStart = source.indexOf('pending', m.index);
		let pendingBlockStart = pendingKwStart + 7;
		while (pendingBlockStart < end && /\s/.test(source[pendingBlockStart])) pendingBlockStart++;
		const isParen = source[pendingBlockStart] === '(';
		const pendingBlockEnd = isParen
			? findMatchingParen(source, pendingBlockStart)
			: findMatchingBrace(source, pendingBlockStart);

		// Extract pending body and replace `render` with `return`
		let pendingBody = source.slice(pendingBlockStart + 1, pendingBlockEnd);
		const renderKwRe = /(?<![.\w])\brender(?=[\s(<])/g;
		pendingBody = pendingBody.replace(renderKwRe, 'return');
		// For paren-body pending (single expression), add return
		if (isParen) pendingBody = `return (${pendingBody})`;

		// Build the __pending declaration
		const pendingDecl = `let __pending = () => {${pendingBody}};`;

		// Find the try block's opening
		const tryBlockClose = source[tryBlockClosePos];
		if (tryBlockClose === '}') {
			// Brace-body try: inject __pending at start of block
			const tryBlockOpenPos = findMatchingBraceBackward(source, tryBlockClosePos);
			s.appendLeft(tryBlockOpenPos + 1, pendingDecl);
			// Remove pending clause text between try close and pending block end
			// Use individual small overwrites to avoid conflicting with later edits
			// Overwrite from after } to end of pending block (the gap + pending keyword + pending body)
			s.overwrite(tryBlockClosePos + 1, pendingBlockEnd + 1, '');
			editedRanges?.push([tryBlockClosePos + 1, pendingBlockEnd + 1]);
		} else {
			// Paren-body try: convert using small targeted edits
			// Source: try (EXPR) pending (PEND) ...
			// Target: try { __pending decl; return (EXPR) } ...
			const tryBlockOpenPos = findMatchingParenBackward(source, tryBlockClosePos);
			// 1. Replace opening ( with { + __pending decl + return (
			s.overwrite(tryBlockOpenPos, tryBlockOpenPos + 1, `{ ${pendingDecl} return (`);
			// 2. Replace ) pending (PEND) with ) }
			s.overwrite(tryBlockClosePos, pendingBlockEnd + 1, ') }');
			editedRanges?.push([tryBlockOpenPos, tryBlockOpenPos + 1]);
			editedRanges?.push([tryBlockClosePos, pendingBlockEnd + 1]);
		}
	}
}

/**
 * Strip `; index <var>` and `; key <expr>` clauses from for-loop headers.
 * Uses ms.move() to preserve source mappings for hover/go-to-definition.
 */
function stripForClauses(source: string, s: MagicString, start: number, end: number): void {
	let pos = start;
	while (pos < end) {
		// Skip strings/comments
		if (source[pos] === "'" || source[pos] === '"') { pos = skipString(source, pos); continue; }
		if (source[pos] === '`') { pos = skipTemplateLiteral(source, pos); continue; }
		if (source[pos] === '/' && source[pos + 1] === '/') { pos = skipLineComment(source, pos); continue; }
		if (source[pos] === '/' && source[pos + 1] === '*') { pos = skipBlockComment(source, pos); continue; }

		// Skip nested brace blocks
		if (source[pos] === '{') {
			const close = findMatchingBrace(source, pos);
			if (close > pos) { pos = close + 1; continue; }
		}

		// Look for `for` keyword
		if (source[pos] === 'f' && /^for\s*[\s(]/.test(source.slice(pos, pos + 10))) {
			let p = pos + 3;
			while (p < end && /\s/.test(source[p])) p++;
			if (p >= end || source[p] !== '(') { pos++; continue; }
			const closeParen = findMatchingParen(source, p);
			if (closeParen <= p || closeParen >= end) { pos++; continue; }

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
						const rangeStart = p + 1 + afterKw;
						indexVarRange = { start: rangeStart, end: rangeStart + varMatch[1].length };
					}
				} else if (clauseMatch[1] === 'key') {
					const rangeStart = p + 1 + afterKw;
					const nextSemi = header.indexOf(';', afterKw);
					let exprEnd = nextSemi !== -1 ? p + 1 + nextSemi : closeParen;
					while (exprEnd > rangeStart && /\s/.test(source[exprEnd - 1])) exprEnd--;
					keyExprRange = { start: rangeStart, end: exprEnd };
				}
			}

			if (firstClauseIdx !== -1) {
				const removeStart = p + 1 + firstClauseIdx;

				// Remove clause syntax but keep the meaningful ranges for move()
				if (indexVarRange && keyExprRange) {
					const first = indexVarRange.start < keyExprRange.start ? indexVarRange : keyExprRange;
					const second = indexVarRange.start < keyExprRange.start ? keyExprRange : indexVarRange;
					s.remove(removeStart, first.start);
					s.remove(first.end, second.start);
					s.remove(second.end, closeParen + 1);
				} else if (indexVarRange) {
					s.remove(removeStart, indexVarRange.start);
					s.remove(indexVarRange.end, closeParen + 1);
				} else if (keyExprRange) {
					s.remove(removeStart, keyExprRange.start);
					s.remove(keyExprRange.end, closeParen + 1);
				}
				// Re-add `)` without source mapping
				s.appendLeft(closeParen + 1, ')');

				// Find body start and inject using move()
				let bodyStart = closeParen + 1;
				while (bodyStart < end && /\s/.test(source[bodyStart])) bodyStart++;

				if (source[bodyStart] === '{') {
					// Block body: move clauses after `{`
					injectForClausesAtBody(s, { indexVar: indexVarRange, keyExpr: keyExprRange }, bodyStart + 1, false, true);
				} else if (source[bodyStart] === '(') {
					// Paren body: wrap in block and inject clauses with return
					const bodyCloseParen = findMatchingParen(source, bodyStart);
					if (bodyCloseParen !== -1) {
						s.appendLeft(bodyStart, '{ ');
						s.prependLeft(bodyCloseParen + 1, ' }');
					}
					injectForClausesAtBody(s, { indexVar: indexVarRange, keyExpr: keyExprRange }, bodyStart, true);
				}
			}

			pos = closeParen + 1;
			continue;
		}
		pos++;
	}
}

interface ForClauseInfo {
	indexVar?: { start: number; end: number };
	keyExpr?: { start: number; end: number };
}

function injectForClausesAtBody(ms: MagicString, clauses: ForClauseInfo, target: number, trailingReturn: boolean, leadingSpace = false): void {
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
 * `if (cond) (<jsx>)` → `if (cond) { return (<jsx>) }`
 */
function rewriteParenBodies(source: string, s: MagicString, start: number, end: number, editedRanges?: [number, number][]): void {
	let pos = start;

	function inEdited(offset: number): boolean {
		if (!editedRanges) return false;
		for (const [s, e] of editedRanges) {
			if (offset >= s && offset < e) return true;
		}
		return false;
	}

	function wrapParenBody(): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		if (inEdited(pos)) {
			// Skip past matching paren without editing
			const cp = findMatchingParen(source, pos);
			if (cp !== -1) pos = cp + 1;
			return true;
		}
		const closeParen = findMatchingParen(source, pos);
		if (closeParen === -1 || closeParen > end) return false;
		s.appendLeft(pos, '{ return ');
		s.prependLeft(closeParen + 1, '}');
		pos = closeParen + 1;
		return true;
	}

	function skipWs(): void {
		while (pos < end && /\s/.test(source[pos])) pos++;
	}

	function skipParens(): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		const close = findMatchingParen(source, pos);
		if (close === -1 || close >= end) return false;
		pos = close + 1;
		return true;
	}

	function handleBody(): boolean {
		skipWs();
		if (pos >= end) return false;
		if (inEdited(pos)) {
			// Skip past edited region
			if (source[pos] === '(') { const cp = findMatchingParen(source, pos); if (cp !== -1) pos = cp + 1; return true; }
			if (source[pos] === '{') { const cb = findMatchingBrace(source, pos); if (cb !== -1) pos = cb + 1; return true; }
			return false;
		}
		if (source[pos] === '(') return wrapParenBody();
		if (source[pos] === '{') {
			const closeBlock = findMatchingBrace(source, pos);
			if (closeBlock !== -1) {
				// Recurse into block body to rewrite nested paren bodies
				rewriteParenBodies(source, s, pos + 1, closeBlock, editedRanges);
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
					// stripForClauses handled the for body conversion,
					// but enter the body to process nested paren bodies
					skipWs();
					if (source[pos] === '{') {
						pos++; // enter the block body
					} else if (source[pos] === '(') {
						// paren body already handled by stripForClauses
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
			const lineBefore = code.slice(lineStart + 1, k + 1).trim();
			if (/^case\b/.test(lineBefore)) return false;
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
// ── Utility functions ──────────────────────────────────────────────

function buildSkipRanges(src: string): [number, number][] {
	const ranges: [number, number][] = [];
	src.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, (match, str, _comment, offset) => {
		if (!str) ranges.push([offset, offset + match.length]);
		return match;
	});
	return ranges;
}

/** Check if a trimmed expression starts with a block-like construct (not a simple expression) */
function isBlockLikeContent(trimmed: string): boolean {
	return /^(if|for|while|switch|try|do|const|let|var|return|throw|class|function)\b/.test(trimmed);
}

function skipWS(code: string, index: number): number {
	while (index < code.length && /\s/.test(code[index])) index++;
	return index;
}

function skipString(code: string, start: number): number {
	const quote = code[start];
	let i = start + 1;
	while (i < code.length) {
		if (code[i] === '\\') { i += 2; continue; }
		if (code[i] === quote) return i + 1;
		i++;
	}
	return i;
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

function findMatchingParen(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === "'" || ch === '"') { i = skipString(code, i); continue; }
		else if (ch === '`') { i = skipTemplateLiteral(code, i); continue; }
		i++;
	}
	return i - 1;
}

function findMatchingBrace(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
		else if (ch === "'" || ch === '"') { i = skipString(code, i); continue; }
		else if (ch === '`') { i = skipTemplateLiteral(code, i); continue; }
		i++;
	}
	return i - 1;
}

function findMatchingBracket(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '[') depth++;
		else if (ch === ']') depth--;
		else if (ch === "'" || ch === '"') { i = skipString(code, i); continue; }
		else if (ch === '`') { i = skipTemplateLiteral(code, i); continue; }
		i++;
	}
	return i - 1;
}

/** Find the matching opening `{` for a closing `}` by scanning backward */
function findMatchingBraceBackward(code: string, closePos: number): number {
	let depth = 1;
	let i = closePos - 1;
	while (i >= 0 && depth > 0) {
		const ch = code[i];
		if (ch === '}') depth++;
		else if (ch === '{') depth--;
		i--;
	}
	return i + 1;
}

/** Find the matching opening `(` for a closing `)` by scanning backward */
function findMatchingParenBackward(code: string, closePos: number): number {
	let depth = 1;
	let i = closePos - 1;
	while (i >= 0 && depth > 0) {
		const ch = code[i];
		if (ch === ')') depth++;
		else if (ch === '(') depth--;
		i--;
	}
	return i + 1;
}

function hasTopLevelComma(expr: string): boolean {
	let depth = 0;
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) return true;
		else if (ch === '\'' || ch === '"') i = skipString(expr, i) - 1;
		else if (ch === '`') i = skipTemplateLiteral(expr, i) - 1;
	}
	return false;
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
				if (code.slice(ns, ne) === tagName && !isSelfClosingTag(code, ne)) nesting++;
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
		else if (code[i] === "'" || code[i] === '"') { i = skipString(code, i); continue; }
		else if (code[i] === '`') { i = skipTemplateLiteral(code, i); continue; }
		i++;
	}
	return i;
}

function isSelfClosingTag(code: string, attrStart: number): boolean {
	let j = attrStart;
	while (j < code.length && code[j] !== '>') {
		if (code[j] === '/' && code[j + 1] === '>') return true;
		if (code[j] === '{') { j = skipJSXExpr(code, j); continue; }
		if (code[j] === "'" || code[j] === '"') { j = skipString(code, j); continue; }
		j++;
	}
	return false;
}

function collectPatternIdentifiers(pattern: string, names: string[]): void {
	const re = /(?:\.\.\.)?(\w+)\s*(?:[:,=}\])]|$)/g;
	let m;
	while ((m = re.exec(pattern)) !== null) {
		const name = m[1];
		if (name && name !== 'undefined') names.push(name);
	}
}

// ── Component Param Helpers ────────────────────────────────────────

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

function parseOneParam(raw: string): ParsedParam {
	let s = raw.trim();

	if (s.startsWith('...')) {
		s = s.slice(3);
		const colonIdx = s.indexOf(':');
		const localName = (colonIdx >= 0 ? s.slice(0, colonIdx) : s).trim();
		const type = colonIdx >= 0 ? s.slice(colonIdx + 1).trim() : null;
		return { isBind: false, isRest: true, isOptional: false, externalName: null, localName, type, defaultValue: null };
	}

	let isBind = false;
	if (/^bind\s/.test(s)) {
		isBind = true;
		s = s.replace(/^bind\s+/, '');
	}

	let externalName: string | null = null;
	if (s[0] === "'" || s[0] === '"') {
		const quote = s[0];
		const closeQuote = s.indexOf(quote, 1);
		if (closeQuote > 0) {
			externalName = s.slice(1, closeQuote);
			s = s.slice(closeQuote + 1).replace(/^\s*as\s+/, '');
		}
	}

	const nameMatch = s.match(/^[\w$]+/);
	if (!nameMatch) return { isBind, isRest: false, isOptional: false, externalName, localName: 'unknown', type: null, defaultValue: null };
	const localName = nameMatch[0];
	s = s.slice(nameMatch[0].length);

	let isOptional = false;
	if (s[0] === '?') {
		isOptional = true;
		s = s.slice(1);
	}
	s = s.trimStart();

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

function editParamForDestructuring(
	ms: MagicString, source: string, range: ParamRange, param: ParsedParam,
): void {
	const raw = range.text;
	const leadingWs = raw.match(/^\s*/)![0].length;
	const contentStart = range.start + leadingWs;

	if (param.isRest) {
		const nameEnd = contentStart + 3 + param.localName.length;
		if (nameEnd < range.end) {
			ms.remove(nameEnd, range.end);
		}
		return;
	}

	let cursor = contentStart;

	if (param.isBind) {
		const bindMatch = source.slice(cursor, range.end).match(/^bind\s+/);
		if (bindMatch) {
			ms.remove(cursor, cursor + bindMatch[0].length);
			cursor += bindMatch[0].length;
		}
	}

	if (param.externalName !== null) {
		const quote = source[cursor];
		const closeQuote = source.indexOf(quote, cursor + 1);
		if (closeQuote > 0) {
			const afterQuote = closeQuote + 1;
			const asMatch = source.slice(afterQuote, range.end).match(/^\s+as\s+/);
			if (asMatch) {
				ms.overwrite(afterQuote, afterQuote + asMatch[0].length, ': ');
			}
			const localStart = afterQuote + (asMatch ? asMatch[0].length : 0);
			const localEnd = localStart + param.localName.length;
			let afterName = localEnd;
			if (source[afterName] === '?') {
				ms.remove(afterName, afterName + 1);
				afterName++;
			}
			if (param.defaultValue !== null) {
				const eqPos = findDefaultEquals(source, afterName, range.end);
				if (eqPos >= 0) {
					let eqStart = eqPos;
					while (eqStart > afterName && source[eqStart - 1] === ' ') eqStart--;
					if (afterName < eqStart) {
						ms.remove(afterName, eqStart);
					}
				}
			} else {
				if (afterName < range.end) {
					ms.remove(afterName, range.end);
				}
			}
		}
	} else {
		const nameEnd = cursor + param.localName.length;
		let afterName = nameEnd;
		if (source[afterName] === '?') {
			ms.remove(afterName, afterName + 1);
			afterName++;
		}
		if (param.defaultValue !== null) {
			const eqPos = findDefaultEquals(source, afterName, range.end);
			if (eqPos >= 0) {
				let eqStart = eqPos;
				while (eqStart > afterName && source[eqStart - 1] === ' ') eqStart--;
				if (afterName < eqStart) {
					ms.remove(afterName, eqStart);
				}
			}
		} else {
			if (afterName < range.end) {
				ms.remove(afterName, range.end);
			}
		}
	}
}

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

// ── Parse with OXC ─────────────────────────────────────────────────

export function parse(filename: string, code: string, lang: 'tsx' | 'jsx' = 'tsx') {
	return oxcParseSync(filename, code, { sourceType: 'module', lang });
}
