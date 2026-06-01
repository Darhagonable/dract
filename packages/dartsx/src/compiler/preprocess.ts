/**
 * Unified DarTsx Preprocessor
 *
 * Transforms DarTsx custom syntax into valid TypeScript/TSX. Used by both:
 * - The compiler pipeline (OXC parsing → analyze → transform → codegen)
 * - The TypeScript plugin (language service type-checking & intellisense)
 *
 * A `mode` option controls the few output differences:
 * - `compiler`: replaces styles with `<$$styleN />` markers
 * - `typecheck`: blanks CSS preserving interpolations, wraps assignment attrs in arrows
 *
 * Both modes produce IIFEs for control flow, full destructured params,
 * $$s/$$d markers, and `satisfies T as T` for typed state.
 * All transforms use MagicString for source-map-safe manipulation.
 *
 * Transforms:
 *   - `component Name(params)` → `function Name({params}: {types})`
 *   - `state x: T =` → `let $$sN = 0, x = init satisfies T as T`
 *   - `derived x =` → `const $$dN = 0, x =`
 *   - `render (...)` → `return (<>...</>)` with IIFE-wrapped control flow
 *   - `{if/for/switch/try}` in JSX → IIFE wrappers `{(() => { ... })()}`
 *   - `bind:{x}` → `bind:x={x}` (shorthand expansion)
 *   - `{@html expr}` → `{__html(expr)}`
 *   - `<style>` blocks → `<$$styleN />` (compiler) or blanked with interpolations (typecheck)
 */

import MagicString, { type SourceMap } from 'magic-string';

// ── Constants ──────────────────────────────────────────────────────

/** Marker identifier prefix for state declarations */
export const STATE_MARKER = '$$s';
/** Marker identifier prefix for derived declarations */
export const DERIVED_MARKER = '$$d';
/** Prefix for style block marker JSX elements (e.g. <$$style0 />) */
export const STYLE_MARKER_PREFIX = '$$style';

// ── Types ──────────────────────────────────────────────────────────

export interface PreprocessOptions {
	/**
	 * - `compiler`: inserts $$s/$$d markers, replaces styles with `<$$styleN />`
	 * - `typecheck`: uses `satisfies T as T`, blanks styles preserving interpolations
	 */
	mode?: 'compiler' | 'typecheck';
}

export interface ComponentMeta {
	name: string;
	isExport: boolean;
	isDefault: boolean;
	isAsync: boolean;
}

export interface ExtractedStyleBlock {
	/** Raw CSS content */
	css: string;
	/** Whether this is a `<style global>` block */
	isGlobal: boolean;
	/** Marker JSX element name (e.g. '$$style0') */
	markerName: string;
}

export interface PreprocessResult {
	/** The transformed valid TSX code */
	code: string;
	/** Source map from output → original */
	map: SourceMap;
	/** Components found during preprocessing */
	components: ComponentMeta[];
	/** All names declared with `state` */
	stateVars: string[];
	/** All names declared with `derived` */
	derivedVars: string[];
	/** Renamed params: componentName → { localName → externalName } */
	renamedParams: Record<string, Record<string, string>>;
	/** Bind params: componentName → list of local names that are bind props */
	bindParams: Record<string, string[]>;
	/** Style blocks extracted from source */
	styleBlocks: ExtractedStyleBlock[];
}

// ── Detection ──────────────────────────────────────────────────────

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

// ── Main entry point ───────────────────────────────────────────────

/**
 * Preprocess DarTsx source into valid TSX.
 * Extracts metadata (components, state, derived, styles) for downstream use.
 */
export function preprocess(source: string, options: PreprocessOptions = {}): PreprocessResult {
	const mode = options.mode ?? 'compiler';
	const ms = new MagicString(source);
	const commentRanges = buildCommentRanges(source);

	// Metadata collectors
	const components: ComponentMeta[] = [];
	const stateVars: string[] = [];
	const derivedVars: string[] = [];
	const renamedParams: Record<string, Record<string, string>> = {};
	const bindParams: Record<string, string[]> = {};
	const styleBlocks: ExtractedStyleBlock[] = [];

	// Transform passes (order matters)
	transformComponentDeclarations(ms, source, commentRanges, components, renamedParams, bindParams, mode);
	transformStateDeclarations(ms, source, commentRanges, stateVars);
	transformDerivedDeclarations(ms, source, commentRanges, derivedVars);
	transformRenderBlocks(ms, source);
	transformStyleBlocks(ms, source, commentRanges, styleBlocks, mode);
	transformJsxAttributes(ms, source);
	transformHtmlDirective(ms, source);

	const code = ms.toString();
	const map = ms.generateMap({ hires: true });

	return { code, map, components, stateVars, derivedVars, renamedParams, bindParams, styleBlocks };
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

// ── Component declarations ─────────────────────────────────────────

function transformComponentDeclarations(
	ms: MagicString,
	source: string,
	commentRanges: SkipRange[],
	components: ComponentMeta[],
	renamedParams: Record<string, Record<string, string>>,
	bindParams: Record<string, string[]>,
	mode: 'compiler' | 'typecheck',
): void {
	const re = /\b((?:export\s+)?(?:default\s+)?(?:async\s+)?)component(\s+(\w+))/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;

		const name = match[3];
		const prefix = match[1];
		components.push({
			name,
			isExport: /\bexport\b/.test(prefix),
			isDefault: /\bdefault\b/.test(prefix),
			isAsync: /\basync\b/.test(prefix),
		});

		// Replace `component` → `function`
		const prefixEnd = match.index + prefix.length;
		ms.overwrite(prefixEnd, prefixEnd + 'component'.length, 'function');

		// Find the param list
		const openParen = source.indexOf('(', match.index + match[0].length);
		if (openParen === -1) continue;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;

		const paramRanges = splitParamRanges(source, openParen + 1, closeParen);
		if (paramRanges.length === 0) continue;
		const parsed = paramRanges.map(r => parseOneParam(r.text));

		// Record renamed and bind params in metadata
		for (const p of parsed) {
			if (p.externalName !== null) {
				if (!renamedParams[name]) renamedParams[name] = {};
				renamedParams[name][p.localName] = p.externalName;
			}
			if (p.isBind) {
				if (!bindParams[name]) bindParams[name] = [];
				bindParams[name].push(p.localName);
				// Bind params with external names: record external name in renamedParams too
				if (p.externalName !== null) {
					if (!renamedParams[name]) renamedParams[name] = {};
					renamedParams[name][p.localName] = p.externalName;
				}
			}
		}

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

		// Replace ( with ({ — original param positions become destructuring bindings
		ms.overwrite(openParen, openParen + 1, '({');
		// Replace ) with }: {type annotation})
		ms.overwrite(closeParen, closeParen + 1, `}: {${typeParts.join(', ')}})`);

		// Edit each param in place to become a destructuring binding
		for (let i = 0; i < paramRanges.length; i++) {
			editParamForDestructuring(ms, source, paramRanges[i], parsed[i]);
		}
	}
}

// ── Param parsing helpers ──────────────────────────────────────────

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

/**
 * Edit a param range in place so the original tokens become a destructuring binding.
 * Uses MagicString remove/overwrite to keep source positions intact.
 */
function editParamForDestructuring(
	ms: MagicString, source: string, range: ParamRange, param: ParsedParam,
): void {
	const raw = range.text;
	const leadingWs = raw.match(/^\s*/)![0].length;
	const contentStart = range.start + leadingWs;

	// Rest params: keep `...name` at original position, remove type
	if (param.isRest) {
		const nameEnd = contentStart + 3 + param.localName.length;
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
	if (param.externalName !== null) {
		const quote = source[cursor];
		const closeQuote = source.indexOf(quote, cursor + 1);
		if (closeQuote > 0) {
			const afterQuote = closeQuote + 1;
			// Replace ` as ` with `: ` (destructuring rename syntax)
			const asMatch = source.slice(afterQuote, range.end).match(/^\s+as\s+/);
			if (asMatch) {
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
		// Simple param: `name: Type = default` → `name = default` or just `name`
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

/** Find first `=` at depth 0, skipping `=>` and `==` */
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

// ── State declarations ─────────────────────────────────────────────

function transformStateDeclarations(
	ms: MagicString, source: string, commentRanges: SkipRange[],
	stateVars: string[],
): void {
	let stateCounter = 0;
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate(\s+(\w+))/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const exportKw = match[1] || '';
		const name = match[3];
		const stateStart = match.index + exportKw.length;
		const stateEnd = stateStart + 'state'.length;
		const afterVar = stateEnd + match[2].length;

		// Validate: next non-ws char after name+type should be =, ;, ), \n or similar
		const afterType = skipTypeAnnotation(source, afterVar);
		let peek = afterType;
		while (peek < source.length && (source[peek] === ' ' || source[peek] === '\t')) peek++;
		if (peek < source.length && !/[=;,)\n]/.test(source[peek])) continue;

		stateVars.push(name);

		// Replace `state` → `let` and insert marker (preserves identifier source positions)
		ms.overwrite(stateStart, stateEnd, 'let');
		ms.appendLeft(stateEnd, ` ${STATE_MARKER}${stateCounter++} = 0,`);

		// Move type annotation to `satisfies T as T` (only when there's an initializer)
		if (source[peek] === '=') {
			const colonIdx = source.indexOf(':', afterVar);
			if (colonIdx !== -1 && colonIdx < peek) {
				const typeText = source.slice(colonIdx + 1, peek).trim();
				ms.overwrite(colonIdx, peek, ' ');
				// Find end of value expression (`;` or `\n` at bracket depth 0)
				let ins = peek + 1, depth = 0;
				while (ins < source.length) {
					const ch = source[ins];
					if (ch === "'" || ch === '"' || ch === '`') { ins = skipString(source, ins); continue; }
					if (ch === '(' || ch === '{' || ch === '[') depth++;
					else if (ch === ')' || ch === '}' || ch === ']') depth--;
					else if (depth === 0 && (ch === ';' || ch === '\n')) break;
					ins++;
				}
				ms.appendLeft(ins, ` satisfies ${typeText} as ${typeText}`);
			}
		} else if (afterType > afterVar) {
			// No initializer but has a type annotation — widen to include undefined
			// since the variable is uninitialized until runtime (e.g. bind:this)
			ms.appendLeft(afterType, ' | undefined');
		}
	}
}

// ── Derived declarations ───────────────────────────────────────────

function transformDerivedDeclarations(
	ms: MagicString, source: string, commentRanges: SkipRange[],
	derivedVars: string[],
): void {
	let derivedCounter = 0;
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[\w{[])/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const start = match.index;
		const exportKw = match[1] || '';
		const derivedStart = start + exportKw.length;
		const afterKeyword = start + match[0].length;
		let cursor = afterKeyword;
		while (cursor < source.length && /\s/.test(source[cursor])) cursor++;

		const nextChar = source[cursor];

		if (nextChar === '{' || nextChar === '[') {
			// Destructuring: derived { a, b } = expr
			const patternEnd = nextChar === '{'
				? findMatchingBrace(source, cursor)
				: findMatchingBracket(source, cursor);
			if (patternEnd === -1) continue;

			let eqCursor = patternEnd + 1;
			while (eqCursor < source.length && /\s/.test(source[eqCursor])) eqCursor++;
			if (source[eqCursor] !== '=') continue;

			const pattern = source.slice(cursor, patternEnd + 1);
			collectPatternIdentifiers(pattern, derivedVars);

			const keywordEnd = derivedStart + 'derived'.length;
			ms.overwrite(derivedStart, keywordEnd, `const ${DERIVED_MARKER}${derivedCounter++} = 0,`);
		} else {
			// Simple: derived name = expr
			const nameMatch = source.slice(cursor).match(/^(\w+)/);
			if (!nameMatch) continue;
			const name = nameMatch[1];
			const matchEnd = cursor + name.length;

			const afterType = skipTypeAnnotation(source, matchEnd);
			let peek = afterType;
			while (peek < source.length && (source[peek] === ' ' || source[peek] === '\t')) peek++;
			if (peek < source.length && !/[=;,)\n]/.test(source[peek])) continue;

			derivedVars.push(name);

			const keywordEnd = derivedStart + 'derived'.length;
			ms.overwrite(derivedStart, keywordEnd, `const ${DERIVED_MARKER}${derivedCounter++} = 0,`);
		}
	}
}

// ── Render blocks ──────────────────────────────────────────────────

function transformRenderBlocks(ms: MagicString, source: string): void {
	const re = /\brender\s*\(/g;
	const processed: { start: number; end: number }[] = [];
	// Track ranges overwritten by rewriteTryToCall (no further edits allowed inside)
	const overwrittenRanges: { start: number; end: number }[] = [];
	let match;
	while ((match = re.exec(source)) !== null) {
		const renderStart = match.index;
		// Skip method calls like `data.render()`
		if (renderStart > 0 && source[renderStart - 1] === '.') continue;
		const openParen = renderStart + match[0].length - 1;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;

		ms.overwrite(renderStart, openParen, 'return ');

		// Check for multi-root JSX
		const inner = source.slice(openParen + 1, closeParen).trim();
		if (inner.startsWith('<') && !isSingleJSXRoot(inner)) {
			ms.appendLeft(openParen + 1, '<>');
			ms.appendLeft(closeParen, '</>');
		}

		// If render content is a single {control-flow} block (not inside JSX),
		// strip the outer braces since they'd be invalid at the return root level
		if (inner.startsWith('{') && !inner.startsWith('{@')) {
			const braceStart = source.indexOf('{', openParen + 1);
			const braceEnd = findMatchingBrace(source, braceStart);
			if (braceEnd !== -1) {
				// Check if the brace encompasses the entire content
				const afterBrace = source.slice(braceEnd + 1, closeParen).trim();
				if (afterBrace === '') {
					ms.overwrite(braceStart, braceStart + 1, ' ');
					ms.overwrite(braceEnd, braceEnd + 1, ' ');
				}
			}
		}

		// Wrap control flow blocks in IIFEs (skip nested render blocks)
		if (!processed.some(r => match!.index > r.start && match!.index < r.end)) {
			processed.push({ start: openParen, end: closeParen });
			wrapControlFlowBlocks(ms, source, openParen + 1, closeParen, overwrittenRanges);
		}
	}

	// render <expr> or render <JSX> → return ...
	// Skip positions that fall inside overwritten try block ranges
	const reOther = /\brender(\s+)(?!\()/g;
	while ((match = reOther.exec(source)) !== null) {
		const pos = match.index;
		// Skip method calls like `obj.render`
		if (pos > 0 && source[pos - 1] === '.') continue;
		if (overwrittenRanges.some(r => pos >= r.start && pos < r.end)) continue;
		ms.overwrite(pos, pos + 'render'.length, 'return');
	}
}

// ── Control flow IIFE wrapping ─────────────────────────────────────

function wrapControlFlowBlocks(ms: MagicString, source: string, start: number, end: number, overwrittenRanges?: { start: number; end: number }[], topLevel = true): void {
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

			// Check if this brace contains a control flow keyword
			let j = i + 1;
			while (j < closeBrace && /\s/.test(source[j])) j++;
			const inner = source.slice(j, j + 10);

			if (/^if\s*\(/.test(inner) || /^for\s*[\s(]/.test(inner) || /^switch\s*\(/.test(inner)) {
				ms.prependRight(i + 1, '(() => { ');
				ms.appendLeft(closeBrace, '})()');
				// For for-loops, strip `; index <var>` and `; key <expr>` clauses
				let forClauses: ForClauseInfo | null = null;
				if (/^for\s*[\s(]/.test(inner)) {
					forClauses = stripForClauses(ms, source, j, closeBrace);
				}
				// Rewrite paren-body control flow to block-body with return
				rewriteParenBodies(ms, source, j, closeBrace, forClauses);
				// Recurse to find nested control flow (not top-level)
				wrapControlFlowBlocks(ms, source, i + 1, closeBrace, overwrittenRanges, false);
			} else if (/^try[\s({<]/.test(inner)) {
				// try/catch/pending → __try(() => { ... }, (e) => { ... }, () => { ... })
				// No recursion: the entire range is overwritten
				rewriteTryToCall(ms, source, i, j, closeBrace);
				overwrittenRanges?.push({ start: j, end: closeBrace });
			} else if (topLevel && /^(const|let|var)\s/.test(inner)) {
				// Anonymous block: { const x = ...; render <expr> }
				// Wrap as IIFE: {(() => { ... })()}
				ms.appendLeft(i + 1, '(() => {');
				ms.appendLeft(closeBrace, '})()');
				// Handle control flow inside the block (rewrite paren bodies, add returns)
				rewriteParenBodies(ms, source, j, closeBrace, null);
			} else {
				// Not a control flow block, still recurse for nested braces
				wrapControlFlowBlocks(ms, source, i + 1, closeBrace, overwrittenRanges, topLevel);
			}

			i = closeBrace + 1;
			continue;
		}
		i++;
	}
}

/**
 * Rewrite `{try { ... } catch (e) { ... } pending { ... }}` to
 * `{__try(() => { ... }, (e) => { ... }, () => { ... })}`.
 *
 * Uses ms.overwrite on the entire try block range. Any `render` keywords
 * within try bodies are converted to `return` in the replacement text.
 *
 * The order in source can be: try/catch/pending, try/pending/catch, try/catch, try/pending.
 * Output order is always: __try(tryFn, catchFn, pendingFn).
 */
function rewriteTryToCall(ms: MagicString, source: string, openBrace: number, tryStart: number, closeBrace: number): void {
	const blocks = parseTryBlocks(source, tryStart, closeBrace);
	if (!blocks) return;

	function bodyToArrow(start: number, end: number, param?: string): string {
		const bodyCh = source[start];
		let body: string;
		if (bodyCh === '{') {
			body = source.slice(start, end);
		} else if (bodyCh === '(') {
			body = `{ return ${source.slice(start, end)} }`;
		} else {
			body = `{ return (${source.slice(start, end)}) }`;
		}
		// Convert `render` keywords to `return` within the body
		body = body.replace(/\brender\b/g, 'return');
		const paramStr = param !== undefined ? `(${param})` : '()';
		return `${paramStr} => ${body}`;
	}

	// Build: __try(tryFn, catchFn, pendingFn)
	let replacement = `__try(${bodyToArrow(blocks.tryBody.start, blocks.tryBody.end)}`;

	if (blocks.catchBlock) {
		replacement += `, ${bodyToArrow(blocks.catchBlock.bodyStart, blocks.catchBlock.bodyEnd, blocks.catchBlock.param)}`;
	} else if (blocks.pendingBlock) {
		// Need null placeholder for missing catch
		replacement += `, null`;
	}

	if (blocks.pendingBlock) {
		replacement += `, ${bodyToArrow(blocks.pendingBlock.bodyStart, blocks.pendingBlock.bodyEnd)}`;
	}

	replacement += ')';
	ms.overwrite(tryStart, closeBrace, replacement);
}

interface TryBlocks {
	tryBody: { start: number; end: number };
	catchBlock?: { param: string; bodyStart: number; bodyEnd: number };
	pendingBlock?: { bodyStart: number; bodyEnd: number };
}

function parseTryBlocks(source: string, tryStart: number, end: number): TryBlocks | null {
	let pos = tryStart + 3; // skip 'try'
	while (pos < end && /\s/.test(source[pos])) pos++;

	// Try body: either { ... } or ( ... )
	let tryBodyStart: number, tryBodyEnd: number;
	if (source[pos] === '{') {
		const close = findMatchingBrace(source, pos);
		if (close === -1 || close > end) return null;
		tryBodyStart = pos;
		tryBodyEnd = close + 1;
		pos = close + 1;
	} else if (source[pos] === '(') {
		const close = findMatchingParen(source, pos);
		if (close === -1 || close > end) return null;
		tryBodyStart = pos;
		tryBodyEnd = close + 1;
		pos = close + 1;
	} else if (source[pos] === '<') {
		// Bare JSX: try <Foo /> catch ...
		const jsxEnd = findJSXEnd(source, pos, end);
		if (jsxEnd === -1) return null;
		tryBodyStart = pos;
		tryBodyEnd = jsxEnd;
		pos = jsxEnd;
	} else {
		return null;
	}

	const result: TryBlocks = { tryBody: { start: tryBodyStart, end: tryBodyEnd } };

	// Parse catch and pending in any order
	while (pos < end) {
		while (pos < end && /\s/.test(source[pos])) pos++;
		if (pos >= end) break;

		const slice = source.slice(pos, pos + 10);
		if (/^catch/.test(slice)) {
			pos += 5;
			while (pos < end && /\s/.test(source[pos])) pos++;
			let param = '';
			if (source[pos] === '(') {
				const closeParen = findMatchingParen(source, pos);
				if (closeParen !== -1) {
					param = source.slice(pos + 1, closeParen).trim();
					pos = closeParen + 1;
				}
			}
			while (pos < end && /\s/.test(source[pos])) pos++;
			const bodyRange = readBlockOrParenRange(source, pos, end);
			if (!bodyRange) break;
			result.catchBlock = { param, bodyStart: bodyRange.start, bodyEnd: bodyRange.end };
			pos = bodyRange.end;
		} else if (/^pending/.test(slice)) {
			pos += 7;
			while (pos < end && /\s/.test(source[pos])) pos++;
			const bodyRange = readBlockOrParenRange(source, pos, end);
			if (!bodyRange) break;
			result.pendingBlock = { bodyStart: bodyRange.start, bodyEnd: bodyRange.end };
			pos = bodyRange.end;
		} else {
			break;
		}
	}

	return result;
}

function readBlockOrParenRange(source: string, pos: number, end: number): { start: number; end: number } | null {
	if (pos >= end) return null;
	if (source[pos] === '{') {
		const close = findMatchingBrace(source, pos);
		if (close === -1 || close > end) return null;
		return { start: pos, end: close + 1 };
	}
	if (source[pos] === '(') {
		const close = findMatchingParen(source, pos);
		if (close === -1 || close > end) return null;
		return { start: pos, end: close + 1 };
	}
	if (source[pos] === '<') {
		const jsxEnd = findJSXEnd(source, pos, end);
		if (jsxEnd === -1) return null;
		return { start: pos, end: jsxEnd };
	}
	return null;
}

/** Find the end of a JSX element starting at `<`. Returns position after element, or -1. */
function findJSXEnd(source: string, start: number, end = source.length): number {
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

// ── For-clause handling ────────────────────────────────────────────

interface ForClauseInfo {
	indexVar?: { start: number; end: number };
	keyExpr?: { start: number; end: number };
}

/**
 * Strip `; index <var>` and `; key <expr>` clauses from for-loop headers.
 * Returns clause ranges for source-map-preserving move().
 */
function stripForClauses(ms: MagicString, source: string, forStart: number, end: number): ForClauseInfo | null {
	let pos = forStart + 3;
	while (pos < end && /\s/.test(source[pos])) pos++;
	if (source[pos] !== '(') return null;
	const openParen = pos;
	const closeParen = findMatchingParen(source, openParen);
	if (closeParen === -1 || closeParen > end) return null;

	const header = source.slice(openParen + 1, closeParen);
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
				const rangeStart = openParen + 1 + afterKw;
				indexVarRange = { start: rangeStart, end: rangeStart + varMatch[1].length };
			}
		} else if (clauseMatch[1] === 'key') {
			const rangeStart = openParen + 1 + afterKw;
			const nextSemi = header.indexOf(';', afterKw);
			let exprEnd = nextSemi !== -1 ? openParen + 1 + nextSemi : closeParen;
			while (exprEnd > rangeStart && /\s/.test(source[exprEnd - 1])) exprEnd--;
			keyExprRange = { start: rangeStart, end: exprEnd };
		}
	}

	if (firstClauseIdx === -1) return null;

	const removeStart = openParen + 1 + firstClauseIdx;

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

	return { indexVar: indexVarRange, keyExpr: keyExprRange };
}

function injectForClausesAtBody(ms: MagicString, clauses: ForClauseInfo, target: number, trailingReturn = false, leadingSpace = false): void {
	const returnStr = trailingReturn ? 'return ' : '';
	if (leadingSpace) ms.appendLeft(target, ' ');

	if (clauses.indexVar) {
		ms.move(clauses.indexVar.start, clauses.indexVar.end, target);
		ms.appendLeft(target, 'let ');
		const indexSuffix = clauses.keyExpr ? ' = 0; ' : ` = 0; ${returnStr}`;
		ms.appendLeft(clauses.indexVar.end, indexSuffix);
	}
	if (clauses.keyExpr) {
		ms.move(clauses.keyExpr.start, clauses.keyExpr.end, target);
		ms.appendLeft(clauses.keyExpr.end, `; ${returnStr}`);
	}
}

// ── Paren-body rewriting ───────────────────────────────────────────

function rewriteParenBodies(ms: MagicString, source: string, start: number, end: number, forClauses?: ForClauseInfo | null): void {
	let pos = start;

	function wrapParenBody(prefix = '{ return '): boolean {
		if (pos >= end || source[pos] !== '(') return false;
		const closeBody = findMatchingParen(source, pos);
		if (closeBody === -1 || closeBody > end) return false;
		// Check for multi-root JSX inside the paren body
		const bodyInner = source.slice(pos + 1, closeBody).trim();
		if (bodyInner.startsWith('<') && !isSingleJSXRoot(bodyInner)) {
			ms.appendLeft(pos + 1, '<>');
			ms.appendLeft(closeBody, '</>');
		}
		ms.appendLeft(pos, prefix);
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
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			if (!skipParens()) break;
			if (isFor && forClauses) {
				skipWs();
				if (pos >= end) break;
				if (source[pos] === '(') {
					const closeBody = findMatchingParen(source, pos);
					if (closeBody === -1 || closeBody > end) break;
					ms.appendLeft(pos, '{ ');
					injectForClausesAtBody(ms, forClauses, pos, true);
					ms.prependLeft(closeBody + 1, '}');
					pos = closeBody + 1;
				} else if (source[pos] === '{') {
					injectForClausesAtBody(ms, forClauses, pos + 1, false, true);
					const closeBlock = findMatchingBrace(source, pos);
					if (closeBlock !== -1) { pos = closeBlock + 1; } else break;
				} else break;
			} else {
				if (!handleBody()) break;
			}
		} else if (/^else/.test(slice)) {
			pos += 4;
			skipWs();
			if (pos >= end) break;
			if (/^if\s*\(/.test(source.slice(pos, pos + 10))) continue;
			if (!handleBody()) break;
		} else if (/^switch\s*\(/.test(slice)) {
			// switch (expr) { case ...: body ... }
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			if (!skipParens()) break;
			skipWs();
			if (pos >= end || source[pos] !== '{') break;
			const switchClose = findMatchingBrace(source, pos);
			if (switchClose === -1 || switchClose > end) break;
			// Rewrite case/default bodies inside the switch block
			rewriteCaseBodies(ms, source, pos + 1, switchClose);
			pos = switchClose + 1;
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
		} else {
			break;
		}
	}
}

/**
 * Inside a switch block, find `case X:` and `default:` entries and
 * add `return` before paren-body expressions: `case X: (<jsx>)` → `case X: return (<jsx>)`
 */
function rewriteCaseBodies(ms: MagicString, source: string, start: number, end: number): void {
	let pos = start;
	while (pos < end) {
		const ch = source[pos];
		if (ch === "'" || ch === '"' || ch === '`') {
			pos = skipString(source, pos);
			continue;
		}
		// Look for `case` or `default`
		if (/^case\s/.test(source.slice(pos, pos + 5))) {
			// Skip past the colon
			const colon = findCaseColon(source, pos + 4, end);
			if (colon === -1) { pos++; continue; }
			pos = colon + 1;
			// Skip whitespace after colon
			while (pos < end && /\s/.test(source[pos])) pos++;
			if (pos < end && (source[pos] === '(' || source[pos] === '<')) {
				ms.appendLeft(pos, 'return ');
				// Remove break after the expression
				removeCaseBreak(ms, source, pos, end);
			}
		} else if (/^default\s*:/.test(source.slice(pos, pos + 10))) {
			const colon = source.indexOf(':', pos + 7);
			if (colon === -1 || colon >= end) { pos++; continue; }
			pos = colon + 1;
			while (pos < end && /\s/.test(source[pos])) pos++;
			if (pos < end && (source[pos] === '(' || source[pos] === '<')) {
				ms.appendLeft(pos, 'return ');
				removeCaseBreak(ms, source, pos, end);
			}
		} else {
			pos++;
		}
	}
}

/** Remove a trailing `break;` after a case body expression */
function removeCaseBreak(ms: MagicString, source: string, exprStart: number, end: number): void {
	// Find end of expression (JSX element or paren group)
	let pos = exprStart;
	if (source[pos] === '(') {
		pos = findMatchingParen(source, pos);
		if (pos === -1) return;
		pos++;
	} else if (source[pos] === '<') {
		const jsxEnd = findJSXEnd(source, pos, end);
		if (jsxEnd === -1) return;
		pos = jsxEnd;
	}
	// Skip whitespace
	while (pos < end && /\s/.test(source[pos])) pos++;
	// Remove break;
	if (source.slice(pos, pos + 6) === 'break;') {
		ms.overwrite(pos, pos + 6, '      ');
	} else if (source.slice(pos, pos + 5) === 'break') {
		// break without semicolon
		let breakEnd = pos + 5;
		if (breakEnd < end && source[breakEnd] === ';') breakEnd++;
		ms.overwrite(pos, breakEnd, ' '.repeat(breakEnd - pos));
	}
}

/**
 * Find the colon after a `case` expression, handling nested parens/brackets.
 */
function findCaseColon(source: string, start: number, end: number): number {
	let pos = start;
	let depth = 0;
	while (pos < end) {
		const ch = source[pos];
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === ':' && depth === 0) return pos;
		else if (ch === "'" || ch === '"' || ch === '`') {
			pos = skipString(source, pos);
			continue;
		}
		pos++;
	}
	return -1;
}

// ── Style blocks ───────────────────────────────────────────────────

function transformStyleBlocks(
	ms: MagicString, source: string, commentRanges: SkipRange[],
	styleBlocks: ExtractedStyleBlock[], mode: 'compiler' | 'typecheck',
): void {
	const styleRe = /<style(\s+global)?\s*>/g;
	let match;
	while ((match = styleRe.exec(source)) !== null) {
		if (isInComment(commentRanges, match.index)) continue;
		const isGlobal = !!match[1];
		const openTagEnd = match.index + match[0].length;
		const closeIdx = source.indexOf('</style>', openTagEnd);
		if (closeIdx === -1) continue;

		const css = source.slice(openTagEnd, closeIdx);
		const fullEnd = closeIdx + '</style>'.length;
		const markerName = `${STYLE_MARKER_PREFIX}${styleBlocks.length}`;
		styleBlocks.push({ css, isGlobal, markerName });

		if (mode === 'compiler') {
			// Replace entire style block with marker element
			ms.overwrite(match.index, fullEnd, `<${markerName} />`);
		} else {
			// typecheck: blank CSS but preserve {expr} interpolations for type-checking
			const interpRe = /\{[a-zA-Z_$][a-zA-Z0-9_$.]*\}/g;
			interpRe.lastIndex = openTagEnd;
			let pos = openTagEnd;
			let m;
			while ((m = interpRe.exec(source)) !== null && m.index < closeIdx) {
				if (pos < m.index) blankRange(ms, source, pos, m.index);
				pos = m.index + m[0].length;
			}
			if (pos < closeIdx) blankRange(ms, source, pos, closeIdx);
		}
	}
}

function blankRange(ms: MagicString, source: string, start: number, end: number): void {
	let blanked = '';
	for (let i = start; i < end; i++) {
		blanked += source[i] === '\n' ? '\n' : ' ';
	}
	ms.overwrite(start, end, blanked);
}

// ── JSX attribute transforms ───────────────────────────────────────

function transformJsxAttributes(ms: MagicString, source: string): void {
	const tagRe = /<([A-Za-z_][\w.]*)(?=[\s/>])/g;
	let tagMatch;
	while ((tagMatch = tagRe.exec(source)) !== null) {
		const attrStart = tagMatch.index + tagMatch[0].length;
		const tagClose = findJsxTagClose(source, attrStart);
		if (tagClose === -1) continue;

		// bind:{x} → bind:x={x} (shorthand expansion)
		const bindShortRe = /bind:\{(\w+)\}/g;
		bindShortRe.lastIndex = attrStart;
		let m;
		while ((m = bindShortRe.exec(source)) !== null && m.index < tagClose) {
			ms.overwrite(m.index, m.index + m[0].length, `bind:${m[1]}={${m[1]}}`);
		}

		// Function bindings: bind:prop={get, set} → bind:prop={[get, set]}
		const bindFnRe = /bind:\w[\w-]*\s*=\s*\{/g;
		bindFnRe.lastIndex = attrStart;
		while ((m = bindFnRe.exec(source)) !== null && m.index < tagClose) {
			const openBrace = m.index + m[0].length - 1;
			const closeBrace = findMatchingBrace(source, openBrace);
			if (closeBrace === -1) continue;
			const inner = source.slice(openBrace + 1, closeBrace);
			if (hasTopLevelComma(inner)) {
				ms.appendLeft(openBrace + 1, '[');
				ms.prependRight(closeBrace, ']');
			}
		}

		// Wrap assignment/update expressions in arrows
		// e.g. onclick={count = 0} → onclick={() => count = 0}
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

function needsWrapping(expr: string): boolean {
	if (/^(\(.*\)\s*=>|[a-zA-Z_$]\w*\s*=>|function[\s(])/.test(expr)) return false;
	const stripped = expr.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
	let depth = 0;
	for (let i = 0; i < stripped.length; i++) {
		const ch = stripped[i];
		if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
		if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
		if (depth !== 0) continue;
		if ((ch === '+' || ch === '-') && stripped[i + 1] === ch) return true;
		if (ch === '=' && stripped[i + 1] === '>') break;
		if (ch === '=' && stripped[i + 1] !== '=' && i > 0 && !'<>!='.includes(stripped[i - 1])) return true;
	}
	return false;
}

function hasTopLevelComma(expr: string): boolean {
	let depth = 0;
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) return true;
		else if (ch === '\'' || ch === '"') i = skipString(expr, i) - 1;
		else if (ch === '`') i = skipString(expr, i) - 1;
	}
	return false;
}

// ── @html directive ────────────────────────────────────────────────

function transformHtmlDirective(ms: MagicString, source: string): void {
	// {@html expr} → {__html(expr)} — handled inside wrapControlFlowBlocks for render context.
	// This handles any remaining occurrences outside render blocks.
	const re = /\{@html\s+/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const openBrace = match.index;
		const closeBrace = findMatchingBrace(source, openBrace);
		if (closeBrace === -1) continue;
		const exprStart = openBrace + match[0].length;
		const expr = source.slice(exprStart, closeBrace).trim();
		ms.overwrite(openBrace, closeBrace + 1, `{__html(${expr})}`);
	}
}

// ── Suppress zones (for typecheck mode) ────────────────────────────

export interface SuppressZone {
	start: number;
	end: number;
}

/**
 * Find regions in DarTsx source where certain TS errors are expected false
 * positives and should be suppressed (control flow blocks, bind: attributes).
 */
export function findSuppressZones(source: string): SuppressZone[] {
	const zones: SuppressZone[] = [];

	const renderRe = /\brender\s*\(/g;
	let match;
	while ((match = renderRe.exec(source)) !== null) {
		const openParen = match.index + match[0].length - 1;
		const closeParen = findMatchingParen(source, openParen);
		if (closeParen === -1) continue;
		collectControlFlowZones(source, openParen + 1, closeParen, zones);
	}

	const bindRe = /\bbind:/g;
	while ((match = bindRe.exec(source)) !== null) {
		const attrStart = match.index;
		let end = attrStart + match[0].length;
		if (end < source.length && source[end] === '{') {
			const closeBrace = findMatchingBrace(source, end);
			end = closeBrace !== -1 ? closeBrace + 1 : end + 1;
		} else {
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
			collectControlFlowZones(source, i + 1, closeBrace, zones);
			i = closeBrace + 1;
			continue;
		}
		i++;
	}
}

// ── Utility functions ──────────────────────────────────────────────

function skipTypeAnnotation(code: string, start: number): number {
	let i = start;
	while (i < code.length && (code[i] === ' ' || code[i] === '\t')) i++;
	if (i >= code.length || code[i] !== ':') return start;
	i++;

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

const findMatchingParen = (code: string, pos: number) => findMatching(code, pos, '(', ')');
const findMatchingBrace = (code: string, pos: number) => findMatching(code, pos, '{', '}');
const findMatchingBracket = (code: string, pos: number) => findMatching(code, pos, '[', ']');

function isSingleJSXRoot(code: string): boolean {
	const trimmed = code.trim();
	if (!trimmed.startsWith('<')) return false;
	const end = findJSXEnd(trimmed, 0);
	if (end <= 0) return false;
	return trimmed.slice(end).trim() === '';
}

function collectPatternIdentifiers(pattern: string, names: string[]): void {
	const re = /(?:\.\.\.)?(\w+)\s*(?:[:,=}\])]|$)/g;
	let m;
	while ((m = re.exec(pattern)) !== null) {
		const name = m[1];
		if (name && name !== 'undefined') names.push(name);
	}
}
