/**
 * Unified DarTsx Preprocessor
 *
 * Transforms DarTsx custom syntax into valid TypeScript/TSX or JavaScript/JSX
 * (type-preserving: the output language follows the input file). Used by both:
 * - The compiler pipeline (OXC parsing → analyze → transform → codegen)
 * - The language service (editor type-checking & intellisense)
 *
 * The source is lexed once (see ./lexer.ts); every transform consumes that
 * token stream — keyword detection classifies statement position from
 * tokens, never from raw characters, so strings, comments, templates,
 * regexes and JSX can never produce false positives. DarTsx keywords
 * (`component`, `state`, `derived`, `render`) are contextual: they rewrite
 * only in statement position, and ordinary JavaScript passes through
 * untouched. Remaining regexes only ever run inside lexer-confirmed
 * regions (JSX tag ranges, style blocks).
 *
 * A `mode` option controls the few output differences:
 * - `compiler`: replaces styles with `<$$styleN />` markers
 * - `typecheck`: blanks CSS preserving interpolations, wraps assignment attrs in arrows
 *
 * A `lang` option (defaulting to the `filename` extension) controls the output
 * language: TS output carries the invented param/type annotations and
 * `satisfies T as T` casts that tsserver consumers read; JS output omits them.
 * User-written TypeScript passes through in both — in JS it is invalid by
 * design and errors downstream, exactly like regular JavaScript.
 *
 * Both modes produce IIFEs for control flow, full destructured params, and
 * $$s/$$d markers.
 * All transforms use MagicString for source-map-safe manipulation.
 *
 * Transforms:
 *   - `component Name(params)` → `function Name({params}: {types})` (TS) / `function Name({params})` (JS)
 *   - `state x: T =` → `let $$sN = 0, x = init satisfies T as T` (TS) / `let $$sN = 0, x = init` (JS)
 *   - `derived x =` → `const $$dN = 0, x =`
 *   - `render (...)` → `return (<>...</>)` with IIFE-wrapped control flow
 *   - `{if/for/switch/try}` in JSX → IIFE wrappers `{(() => { ... })()}`
 *   - `bind:{x}` → `bind:x={x}` (shorthand expansion)
 *   - `{@html expr}` → `{__html(expr)}`
 *   - `<style>` blocks → `<$$styleN />` (compiler) or blanked with interpolations (typecheck)
 */

import MagicString, { type SourceMap } from 'magic-string';
import {
	lex,
	skipString,
	findJSXEnd,
	type LexResult,
	type Token,
} from './lexer.js';

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
	/**
	 * Target language of the lowered output — type-preserving:
	 * - `ts`: emits the invented param/type annotations and `satisfies T as T`
	 *   casts that tsserver consumers read
	 * - `js`: omits invented annotations. User-written TypeScript passes
	 *   through untouched — it is invalid JavaScript by design and errors
	 *   downstream, the same way regular JavaScript rejects it
	 * Defaults to inferring from `filename`'s extension (`.js`/`.jsx`/`.mjs`/
	 * `.cjs` → `js`), else `ts`.
	 */
	lang?: 'ts' | 'js';
	/** Filename recorded in the generated source map (for remapping chains). */
	filename?: string;
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
	/** The transformed valid TSX/JSX code */
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
 * Detect whether a source file contains DarTsx syntax.
 *
 * Runs on the lexer's token stream, so strings, comments, templates and
 * regexes mentioning `state`/`derived`/`render` never cause false
 * positives. Detection is deliberately lenient (no statement-position
 * filter): a false positive just passes through preprocessing unchanged.
 */
export function isDarTsxFile(content: string): boolean {
	const { tokens, keywords } = lex(content);

	for (let i = 0; i < keywords.length; i++) {
		const { index, token } = keywords[i];
		const next = tokens[index + 1];
		if (!next) continue;
		switch (token.text) {
			case 'component': {
				const paren = tokens[index + 2];
				if (next.kind === 'word' && paren?.kind === 'punct' && paren.text === '(') return true;
				break;
			}
			case 'state':
				if (next.kind === 'word') return true;
				break;
			case 'derived':
				if (next.kind === 'word' || (next.kind === 'punct' && (next.text === '{' || next.text === '['))) return true;
				break;
			case 'render':
				if ((next.kind === 'punct' && next.text === '(')
					|| (next.kind === 'operator' && next.text === '<')
					|| next.kind === 'jsx') return true;
				break;
		}
	}

	// bind:{x} / bind:name={…} attributes only appear inside JSX tags
	const bindRe = /\bbind:(?:\{[a-zA-Z_]\w*\}|[a-zA-Z][\w-]*)\b/;
	return tokens.some((t) => t.kind === 'jsx' && bindRe.test(t.text));
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Preprocess DarTsx source into valid TSX.
 * Extracts metadata (components, state, derived, styles) for downstream use.
 */
export function preprocess(source: string, options: PreprocessOptions = {}): PreprocessResult {
	const mode = options.mode ?? 'compiler';
	const lang = options.lang ?? (/\.[cm]?jsx?$/.test(options.filename ?? '') ? 'js' : 'ts');
	const ms = new MagicString(source);
	const lexed = lex(source);

	// Metadata collectors
	const components: ComponentMeta[] = [];
	const stateVars: string[] = [];
	const derivedVars: string[] = [];
	const renamedParams: Record<string, Record<string, string>> = {};
	const bindParams: Record<string, string[]> = {};
	const styleBlocks: ExtractedStyleBlock[] = [];

	// Transform passes (order matters)
	transformComponentDeclarations(ms, source, lexed, components, renamedParams, bindParams, lang);
	transformStateDeclarations(ms, source, lexed, stateVars, lang);
	transformDerivedDeclarations(ms, source, lexed, derivedVars);
	transformRenderBlocks(ms, source, lexed);
	transformStyleBlocks(ms, source, lexed, styleBlocks, mode);
	transformJsxAttributes(ms, source, lexed);
	transformHtmlDirective(ms, source, lexed);

	const code = ms.toString();
	// The map must name its source (and include it) or a remapping chain that
	// resolves through it drops every mapping: an unnamed source resolves to
	// null and the original positions are discarded as unmapped.
	const map = ms.generateMap({
		hires: true,
		source: options.filename ?? 'input.tsx',
		includeContent: true,
	});

	return { code, map, components, stateVars, derivedVars, renamedParams, bindParams, styleBlocks };
}

// ── Component declarations ─────────────────────────────────────────

function transformComponentDeclarations(
	ms: MagicString,
	source: string,
	lexed: LexResult,
	components: ComponentMeta[],
	renamedParams: Record<string, Record<string, string>>,
	bindParams: Record<string, string[]>,
	lang: 'ts' | 'js',
): void {
	const { tokens, matchIndex, keywords } = lexed;

	for (const { index, token, enclosed, jsxHoleStart } of keywords) {
		if (token.text !== 'component') continue;
		const nameTok = tokens[index + 1];
		if (!nameTok || nameTok.kind !== 'word') continue;
		const name = nameTok.text;

		// `export default async component …` — the declaration chain
		const chain = declarationChainStart(tokens, index);
		const prev = chain > 0 ? tokens[chain - 1] : undefined;
		if (!isStatementPosition(prev, enclosed, tokens[chain].newlineBefore, jsxHoleStart)) continue;
		const prefixWords = new Set(
			tokens.slice(chain, index).filter((t) => t.kind === 'word').map((t) => t.text),
		);

		components.push({
			name,
			isExport: prefixWords.has('export'),
			isDefault: prefixWords.has('default'),
			isAsync: prefixWords.has('async'),
		});

		// Replace `component` → `function`
		ms.overwrite(token.start, token.end, 'function');

		// Find the param list, skipping optional type parameters `<T extends …>`
		let openIdx = index + 2;
		if (tokens[openIdx]?.kind === 'operator' && tokens[openIdx].text === '<') {
			let depth = 0;
			while (openIdx < tokens.length) {
				const t = tokens[openIdx];
				if (t.kind === 'operator') {
					if (t.text === '<' || t.text === '<<') depth += t.text.length;
					else if (t.text === '>' || t.text === '>>' || t.text === '>>>') {
						depth -= t.text.length;
						if (depth <= 0) break;
					}
				}
				openIdx++;
			}
			openIdx++; // first token after the closing `>`
		}
		const openTok = tokens[openIdx];
		if (!openTok || openTok.kind !== 'punct' || openTok.text !== '(') continue;
		const closeIdx = matchIndex.get(openIdx);
		if (closeIdx === undefined) continue;
		const closeTok = tokens[closeIdx];

		const paramRanges = splitParamRanges(source, tokens, openIdx, closeIdx);
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

		// Replace ( with ({ — original param positions become destructuring bindings
		ms.overwrite(openTok.start, openTok.start + 1, '({');
		// Replace ) with }: {type annotation}) — TS output carries the invented
		// type literal for tsserver consumers; JS output has no annotation
		if (lang === 'js') {
			ms.overwrite(closeTok.start, closeTok.start + 1, '})');
		} else {
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
			ms.overwrite(closeTok.start, closeTok.start + 1, `}: {${typeParts.join(', ')}})`);
		}

		// Edit each param in place to become a destructuring binding
		for (let i = 0; i < paramRanges.length; i++) {
			editParamForDestructuring(ms, source, paramRanges[i], parsed[i], lang);
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

/** Split a param list into per-param ranges at depth-0 comma tokens. */
function splitParamRanges(source: string, tokens: readonly Token[], openIdx: number, closeIdx: number): ParamRange[] {
	const ranges: ParamRange[] = [];
	let depth = 0;
	let current: Token | undefined = tokens[openIdx + 1];
	for (let k = openIdx + 1; k < closeIdx; k++) {
		const t = tokens[k];
		if (t.kind === 'punct' && '([{'.includes(t.text)) depth++;
		else if (t.kind === 'punct' && ')]}'.includes(t.text)) depth--;
		else if (t.kind === 'punct' && t.text === ',' && depth === 0) {
			if (current) ranges.push({ text: source.slice(current.start, t.start), start: current.start, end: t.start });
			current = tokens[k + 1];
		}
	}
	if (current && current.start < tokens[closeIdx].start) {
		ranges.push({ text: source.slice(current.start, tokens[closeIdx].start), start: current.start, end: tokens[closeIdx].start });
	}
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
 * The DarTsx syntax (`bind `, `'ext' as local`) lowers for both languages;
 * TypeScript-only syntax (annotations, `?`) is only removed for TS output —
 * in JS it passes through untouched, exactly like regular JavaScript.
 */
function editParamForDestructuring(
	ms: MagicString, source: string, range: ParamRange, param: ParsedParam,
	lang: 'ts' | 'js',
): void {
	const raw = range.text;
	const leadingWs = raw.match(/^\s*/)![0].length;
	const contentStart = range.start + leadingWs;

	// Rest params: keep `...name` at original position, remove type (TS only)
	if (param.isRest) {
		if (lang === 'ts') {
			const nameEnd = contentStart + 3 + param.localName.length;
			if (nameEnd < range.end) {
				ms.remove(nameEnd, range.end);
			}
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
			if (lang === 'js') return;
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
		// (TS only — JS passes annotations and `?` through)
		if (lang === 'js') return;
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
	ms: MagicString, source: string, lexed: LexResult,
	stateVars: string[],
	lang: 'ts' | 'js',
): void {
	let stateCounter = 0;
	const { tokens, keywords } = lexed;

	for (const { index, token, enclosed, jsxHoleStart } of keywords) {
		if (token.text !== 'state') continue;
		const nameTok = tokens[index + 1];
		if (!nameTok || nameTok.kind !== 'word') continue;

		// `export state …` — the declaration starts at `export`
		const chain = declarationChainStart(tokens, index);
		const prev = chain > 0 ? tokens[chain - 1] : undefined;
		if (!isStatementPosition(prev, enclosed, tokens[chain].newlineBefore, jsxHoleStart)) continue;

		// Optional `: Type` annotation, then the statement terminator
		const decl = declarationTerminator(tokens, index + 1);
		if (!decl) continue;
		const { colonTok, terminator } = decl;

		stateVars.push(nameTok.text);

		// Replace `state` → `let` and insert marker (preserves identifier source positions)
		ms.overwrite(token.start, token.end, 'let');
		ms.appendLeft(token.end, ` ${STATE_MARKER}${stateCounter++} = 0,`);

		// Move type annotation to `satisfies T as T` (TS only, when there's an
		// initializer) — JS output passes user-written annotations through
		if (terminator.kind === 'operator' && terminator.text === '=') {
			if (colonTok !== undefined && lang === 'ts') {
				ms.overwrite(colonTok.start, terminator.start, ' ');
				const typeText = source.slice(colonTok.end, terminator.start).trim();
				ms.appendLeft(valueEndOffset(source, tokens, decl.terminatorIdx), ` satisfies ${typeText} as ${typeText}`);
			}
		} else if (colonTok !== undefined && lang === 'ts') {
			// No initializer but has a type annotation — widen to include
			// undefined since the variable is uninitialized until runtime
			// (e.g. bind:this). JS passes the annotation through.
			ms.appendLeft(statementBreakOffset(source, tokens, decl.terminatorIdx), ' | undefined');
		}
	}
}

/**
 * Locate the terminator of a `name [: Type]` declaration and validate it:
 * after the optional annotation the declaration must end at `=`, `;`, `,`,
 * `)` or a line break. Returns null when the shape doesn't match.
 */
function declarationTerminator(
	tokens: readonly Token[], nameIdx: number,
): { colonTok: Token | undefined; terminator: Token; terminatorIdx: number } | null {
	let cursor = nameIdx + 1;
	let colonTok: Token | undefined;
	if (tokens[cursor]?.kind === 'punct' && tokens[cursor].text === ':') {
		colonTok = tokens[cursor];
		cursor = typeEndTokenIndex(tokens, cursor + 1);
	}
	const terminator = tokens[cursor];
	if (!terminator) return null;
	const ends = terminator.newlineBefore
		|| (terminator.kind === 'operator' && terminator.text === '=')
		|| (terminator.kind === 'punct' && (terminator.text === ';' || terminator.text === ',' || terminator.text === ')'));
	return ends ? { colonTok, terminator, terminatorIdx: cursor } : null;
}

/** Token index of the first token of a declaration's `export`/`default`/`async` prefix chain. */
function declarationChainStart(tokens: readonly Token[], index: number): number {
	let chain = index;
	while (chain > 0 && tokens[chain - 1].kind === 'word'
		&& (tokens[chain - 1].text === 'export' || tokens[chain - 1].text === 'default' || tokens[chain - 1].text === 'async')) {
		chain--;
	}
	return chain;
}

/**
 * Token index of the terminator ending a type annotation that starts at
 * `start`: the first depth-0 `=`, `;`, closer, or token on a new line —
 * mirroring how the grammar ends a type in a declaration.
 */
function typeEndTokenIndex(tokens: readonly Token[], start: number): number {
	let depth = 0;
	for (let k = start; k < tokens.length; k++) {
		const t = tokens[k];
		if (t.kind === 'punct') {
			if (t.text === '(' || t.text === '[' || t.text === '{') depth++;
			else if (t.text === ')' || t.text === ']' || t.text === '}') {
				if (depth === 0) return k;
				depth--;
			} else if (depth === 0 && t.text === ';') return k;
		} else if (t.kind === 'operator') {
			if (depth === 0 && t.text === '=') return k;
			if (t.text === '<') depth++;
			else if (t.text === '>') { if (depth === 0) return k; depth--; }
		}
		if (depth === 0 && t.newlineBefore) return k;
	}
	return tokens.length;
}

/**
 * Offset where the statement containing `tokens[index]` breaks: the token's
 * start, or the line break immediately before it (insertion stays on the
 * statement's own line).
 */
function statementBreakOffset(source: string, tokens: readonly Token[], index: number): number {
	const t = tokens[index];
	if (!t) return source.length;
	if (!t.newlineBefore) return t.start;
	const nl = source.indexOf('\n', tokens[index - 1].end);
	return nl !== -1 && nl < t.start ? nl : t.start;
}

/**
 * Offset just past a `= initializer` value expression: the `;` or line
 * break at bracket depth 0 that ends the statement.
 */
function valueEndOffset(source: string, tokens: readonly Token[], equalsIndex: number): number {
	let depth = 0;
	for (let k = equalsIndex + 1; k < tokens.length; k++) {
		const t = tokens[k];
		if (depth === 0 && t.kind === 'punct' && t.text === ';') return t.start;
		if (depth === 0 && t.newlineBefore) return statementBreakOffset(source, tokens, k);
		if (t.kind === 'punct' && '([{'.includes(t.text)) depth++;
		else if (t.kind === 'punct' && ')]}'.includes(t.text)) depth--;
	}
	return source.length;
}

// ── Derived declarations ───────────────────────────────────────────

function transformDerivedDeclarations(
	ms: MagicString, source: string, lexed: LexResult,
	derivedVars: string[],
): void {
	let derivedCounter = 0;
	const { tokens, matchIndex, keywords } = lexed;

	for (const { index, token, enclosed, jsxHoleStart } of keywords) {
		if (token.text !== 'derived') continue;
		const next = tokens[index + 1];
		if (!next) continue;
		// the grammar requires whitespace between `derived` and its binding
		if (!/\s/.test(source[token.end] ?? '')) continue;

		// `export derived …` — the declaration starts at `export`
		const chain = declarationChainStart(tokens, index);
		const prev = chain > 0 ? tokens[chain - 1] : undefined;
		if (!isStatementPosition(prev, enclosed, tokens[chain].newlineBefore, jsxHoleStart)) continue;

		if ((next.kind === 'punct' && (next.text === '{' || next.text === '['))) {
			// Destructuring: derived { a, b } = expr
			const closeIdx = matchIndex.get(index + 1);
			if (closeIdx === undefined) continue;
			const afterPattern = tokens[closeIdx + 1];
			if (!afterPattern || afterPattern.kind !== 'operator' || afterPattern.text !== '=') continue;

			collectPatternIdentifiers(source.slice(next.start, tokens[closeIdx].end), derivedVars);
			ms.overwrite(token.start, token.end, `const ${DERIVED_MARKER}${derivedCounter++} = 0,`);
		} else if (next.kind === 'word') {
			// Simple: derived name = expr — optional `: Type`, then terminator
			if (!declarationTerminator(tokens, index + 1)) continue;

			derivedVars.push(next.text);
			ms.overwrite(token.start, token.end, `const ${DERIVED_MARKER}${derivedCounter++} = 0,`);
		}
	}
}

// ── Render blocks ──────────────────────────────────────────────────

/**
 * `render` is a contextual keyword: it initiates a render block only in
 * statement position — exactly where a `return` statement would be legal.
 * Everywhere else (expression slots, method calls, method definitions,
 * property names) it is an ordinary identifier and must pass through
 * untouched, the same way regular JavaScript keeps `{ return: 5 }` intact.
 *
 * Classification runs on the lexer's token stream — previous significant
 * token, delimiter nesting, and ASI newline flags — never on raw
 * characters, so strings, comments, templates, regexes and JSX can never
 * produce false positives.
 */
function transformRenderBlocks(ms: MagicString, source: string, lexed: LexResult): void {
	const { tokens, matchIndex, keywords } = lexed;
	// Track ranges overwritten by rewriteTryToCall (no further edits allowed inside)
	const overwrittenRanges: { start: number; end: number }[] = [];
	// Track render-block paren ranges already wrapped in control-flow IIFEs
	const processed: { start: number; end: number }[] = [];

	// `render (…)` → `return (…)`
	for (const { index, token, prev, enclosed, jsxHoleStart } of keywords) {
		if (token.text !== 'render') continue;
		const next = tokens[index + 1];
		if (!next || next.kind !== 'punct' || next.text !== '(') continue;
		// A comment between `render` and `(` is not the call form (the paren
		// may belong to the comment's follow-up expression — see pass 2)
		if (!gapIsWhitespace(source, token.end, next.start)) continue;
		const closeIdx = matchIndex.get(index + 1);
		if (closeIdx === undefined) continue;
		if (!isStatementPosition(prev, enclosed, token.newlineBefore, jsxHoleStart)) continue;
		// `render(args) { … }` is a method/class definition, never a render block
		const afterClose = tokens[closeIdx + 1];
		if (afterClose?.kind === 'punct' && afterClose.text === '{') continue;

		const renderStart = token.start;
		const openParen = next.start;
		const closeParen = tokens[closeIdx].start;

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
		if (!processed.some(r => renderStart > r.start && renderStart < r.end)) {
			processed.push({ start: openParen, end: closeParen });
			wrapControlFlowBlocks(ms, source, openParen + 1, closeParen, overwrittenRanges);
		}
	}

	// render <expr> or render <JSX> → return ...
	// Skips positions that fall inside overwritten try block ranges
	for (const { index, token, prev, enclosed, jsxHoleStart } of keywords) {
		if (token.text !== 'render') continue;
		const next = tokens[index + 1];
		// Trailing `render\n` at end of file still matches (the expression
		// simply isn't there yet); a following `(` was pass 1's job
		const gapStart = token.end;
		const gapEnd = next?.start ?? source.length;
		if (source[gapStart] === undefined || !/\s/.test(source[gapStart])) continue;
		if (next?.kind === 'punct' && next.text === '(' && gapIsWhitespace(source, gapStart, gapEnd)) continue;
		if (overwrittenRanges.some(r => token.start >= r.start && token.start < r.end)) continue;
		if (!isStatementPosition(prev, enclosed, token.newlineBefore, jsxHoleStart)) continue;
		ms.overwrite(token.start, token.end, 'return');
	}
}

// ── Contextual keyword analysis ────────────────────────────────────

/** Words after which an expression (not a statement) begins. */
const OPERAND_KEYWORDS = new Set([
	'return', 'throw', 'await', 'typeof', 'new', 'case', 'void', 'yield', 'delete', 'instanceof', 'in', 'of',
]);

/** Words after which a statement may begin (like `else return`). */
const STATEMENT_KEYWORDS = new Set(['else', 'do']);

/**
 * Decide whether a keyword token sits in statement position — exactly
 * where a statement would be legal — from the previous significant token,
 * the delimiter nesting, and whether a line break (ASI) separates them.
 *
 * When classification isn't confident, returns false: a missed keyword
 * fails loudly downstream, while a false positive silently corrupts
 * ordinary JavaScript.
 */
function isStatementPosition(
	prev: Token | undefined,
	enclosed: boolean,
	newlineBefore: boolean,
	jsxHoleStart = false,
): boolean {
	if (enclosed || jsxHoleStart) return false; // inside ( or [ — an expression slot; a JSX hole's leading expression likewise
	if (!prev) return true; // start of file

	if (prev.kind === 'punct') {
		switch (prev.text) {
			case ';': case '{': case '}': case ')':
				return true; // statement boundary / brace-less control body
			case ']':
				return newlineBefore; // index end: statement only via ASI
			default:
				return false; // ( [ , : . ? — operand slots
		}
	}
	if (prev.kind === 'word') {
		if (STATEMENT_KEYWORDS.has(prev.text)) return true;
		if (OPERAND_KEYWORDS.has(prev.text)) return false;
		return newlineBefore; // a value token: statement only via ASI
	}
	if (prev.kind === 'jsx') return newlineBefore; // closed element: statement only via ASI
	if (prev.kind === 'operator') {
		// Postfix ++/-- completes a statement; binary operators leave the
		// keyword in expression position
		return prev.text === '++' || prev.text === '--' ? newlineBefore : false;
	}
	// number, string, template, regex — value tokens
	return newlineBefore;
}

/** Whether every character between two offsets is whitespace. */
function gapIsWhitespace(source: string, start: number, end: number): boolean {
	for (let i = start; i < end; i++) {
		if (!/\s/.test(source[i])) return false;
	}
	return true;
}

// ── Control flow IIFE wrapping ─────────────────────────────────────

/** Skip whitespace up to `end`, returning the new position. */
function skipWs(source: string, pos: number, end: number): number {
	while (pos < end && /\s/.test(source[pos])) pos++;
	return pos;
}

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
			j = skipWs(source, j, closeBrace);
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
	pos = skipWs(source, pos, end);

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
		pos = skipWs(source, pos, end);
		if (pos >= end) break;

		const slice = source.slice(pos, pos + 10);
		if (/^catch/.test(slice)) {
			pos += 5;
			pos = skipWs(source, pos, end);
			let param = '';
			if (source[pos] === '(') {
				const closeParen = findMatchingParen(source, pos);
				if (closeParen !== -1) {
					param = source.slice(pos + 1, closeParen).trim();
					pos = closeParen + 1;
				}
			}
			pos = skipWs(source, pos, end);
			const bodyRange = readBlockOrParenRange(source, pos, end);
			if (!bodyRange) break;
			result.catchBlock = { param, bodyStart: bodyRange.start, bodyEnd: bodyRange.end };
			pos = bodyRange.end;
		} else if (/^pending/.test(slice)) {
			pos += 7;
			pos = skipWs(source, pos, end);
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
	pos = skipWs(source, pos, end);
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

	function handleBody(prefix = '{ return '): boolean {
		pos = skipWs(source, pos, end);
		if (pos >= end) return false;
		if (source[pos] === '(') return wrapParenBody(prefix);
		if (source[pos] === '{') {
			const closeBlock = findMatchingBrace(source, pos);
			if (closeBlock !== -1) { pos = closeBlock + 1; return true; }
		}
		return false;
	}

	while (pos < end) {
		pos = skipWs(source, pos, end);
		if (pos >= end) break;

		const slice = source.slice(pos, pos + 10);

		if (/^(if|for|while)\s*[\s(]/.test(slice)) {
			const isFor = /^for\s/.test(slice);
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			if (!skipParens()) break;
			if (isFor && forClauses) {
				pos = skipWs(source, pos, end);
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
			pos = skipWs(source, pos, end);
			if (pos >= end) break;
			if (/^if\s*\(/.test(source.slice(pos, pos + 10))) continue;
			if (!handleBody()) break;
		} else if (/^switch\s*\(/.test(slice)) {
			// switch (expr) { case ...: body ... }
			const kwEnd = source.indexOf('(', pos);
			if (kwEnd === -1 || kwEnd >= end) break;
			pos = kwEnd;
			if (!skipParens()) break;
			pos = skipWs(source, pos, end);
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
			pos = skipWs(source, pos, end);
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
			pos = skipWs(source, pos, end);
			if (pos < end && (source[pos] === '(' || source[pos] === '<')) {
				ms.appendLeft(pos, 'return ');
				// Remove break after the expression
				removeCaseBreak(ms, source, pos, end);
			}
		} else if (/^default\s*:/.test(source.slice(pos, pos + 10))) {
			const colon = source.indexOf(':', pos + 7);
			if (colon === -1 || colon >= end) { pos++; continue; }
			pos = colon + 1;
			pos = skipWs(source, pos, end);
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
	pos = skipWs(source, pos, end);
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
	ms: MagicString, source: string, lexed: LexResult,
	styleBlocks: ExtractedStyleBlock[], mode: 'compiler' | 'typecheck',
): void {
	const { tokens, matchIndex } = lexed;
	const styleTagRe = /^<style(\s+global)?\s*>$/;

	for (let i = 0; i < tokens.length; i++) {
		const openTok = tokens[i];
		if (openTok.kind !== 'jsx') continue;
		const tagMatch = styleTagRe.exec(openTok.text);
		if (!tagMatch) continue;

		// The matching </style> closes the block
		let closeIdx = -1;
		for (let k = i + 1; k < tokens.length; k++) {
			if (tokens[k].kind === 'jsx' && tokens[k].text === '</style>') { closeIdx = k; break; }
		}
		if (closeIdx === -1) continue;
		const closeTok = tokens[closeIdx];

		const isGlobal = !!tagMatch[1];
		const css = source.slice(openTok.end, closeTok.start);
		const markerName = `${STYLE_MARKER_PREFIX}${styleBlocks.length}`;
		styleBlocks.push({ css, isGlobal, markerName });

		if (mode === 'compiler') {
			// Replace entire style block with marker element
			ms.overwrite(openTok.start, closeTok.end, `<${markerName} />`);
		} else {
			// typecheck: blank CSS but preserve {expr} interpolations for type-checking.
			// Interpolation holes are the `{…}` token pairs inside the block
			// whose contents are a bare identifier chain (no whitespace).
			let pos = openTok.end;
			for (let k = i + 1; k < closeIdx; k++) {
				const t = tokens[k];
				if (t.kind !== 'punct' || t.text !== '{') continue;
				const end = matchIndex.get(k);
				if (end === undefined || end >= closeIdx) continue;
				if (!isIdentifierChainHole(source, tokens, k, end)) continue;
				if (pos < t.start) blankRange(ms, source, pos, t.start);
				pos = tokens[end].start + 1;
			}
			if (pos < closeTok.start) blankRange(ms, source, pos, closeTok.start);
		}
	}
}

/** Whether `{` … `}` tokens hold a bare identifier chain like `{a.b.c}` (a CSS interpolation). */
function isIdentifierChainHole(source: string, tokens: readonly Token[], openIdx: number, closeIdx: number): boolean {
	if (openIdx + 1 >= closeIdx) return false;
	const inner = source.slice(tokens[openIdx].end, tokens[closeIdx].start);
	if (/\s/.test(inner)) return false;
	for (let k = openIdx + 1; k < closeIdx; k++) {
		const t = tokens[k];
		const ok = t.kind === 'word' || (t.kind === 'punct' && t.text === '.');
		if (!ok) return false;
	}
	return true;
}

function blankRange(ms: MagicString, source: string, start: number, end: number): void {
	let blanked = '';
	for (let i = start; i < end; i++) {
		blanked += source[i] === '\n' ? '\n' : ' ';
	}
	ms.overwrite(start, end, blanked);
}

// ── JSX attribute transforms ───────────────────────────────────────

function transformJsxAttributes(ms: MagicString, source: string, lexed: LexResult): void {
	for (const tag of lexed.tokens) {
		if (tag.kind !== 'jsx') continue;
		// Opening and self-closing tags only: `<name attrs…>` / `<name … />`
		const nameMatch = /^<([A-Za-z_][\w.]*)/.exec(tag.text);
		if (!nameMatch) continue;
		const attrStart = tag.start + 1 + nameMatch[1].length;
		// bound is the offset of the tag's closing `>` (or the `/` of `/>`)
		const tagClose = tag.text.endsWith('/>') ? tag.end - 2 : tag.end - 1;

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

function transformHtmlDirective(ms: MagicString, source: string, lexed: LexResult): void {
	// {@html expr} → {__html(expr)} — handled inside wrapControlFlowBlocks for render context.
	// This handles any remaining occurrences outside render blocks.
	const { tokens, matchIndex } = lexed;
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		// `{` `@` `html` followed by whitespace begins the directive
		if (t.kind !== 'operator' || t.text !== '@') continue;
		const at = tokens[i - 1];
		const name = tokens[i + 1];
		if (!at || at.kind !== 'punct' || at.text !== '{') continue;
		if (!name || name.kind !== 'word' || name.text !== 'html') continue;
		if (!/\s/.test(source[name.end] ?? '')) continue;
		const closeIdx = matchIndex.get(i - 1);
		if (closeIdx === undefined) continue;
		const expr = source.slice(name.end, tokens[closeIdx].start).trim();
		ms.overwrite(at.start, tokens[closeIdx].start + 1, `{__html(${expr})}`);
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
	const { tokens, matchIndex, keywords } = lex(source);

	// Every render(…) call form, however classified, may contain control flow
	for (const { index, token } of keywords) {
		if (token.text !== 'render') continue;
		const next = tokens[index + 1];
		if (!next || next.kind !== 'punct' || next.text !== '(') continue;
		if (!gapIsWhitespace(source, token.end, next.start)) continue;
		const closeIdx = matchIndex.get(index + 1);
		if (closeIdx === undefined) continue;
		collectControlFlowZones(source, next.start + 1, tokens[closeIdx].start, zones);
	}

	// bind: attributes only appear inside JSX tags
	const bindRe = /\bbind:/g;
	for (const tag of tokens) {
		if (tag.kind !== 'jsx') continue;
		bindRe.lastIndex = tag.start;
		let match;
		while ((match = bindRe.exec(source)) !== null && match.index < tag.end) {
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
			j = skipWs(source, j, closeBrace);
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
