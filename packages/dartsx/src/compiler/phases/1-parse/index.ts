/**
 * Phase 1 — Parse
 *
 * Pre-processes DarTsx custom syntax into valid TSX that OXC can parse,
 * then parses with OXC. Returns the AST plus metadata about which
 * identifiers are state/derived/components.
 */
import {
	parseSync as oxcParseSync,
	type SwitchStatement,
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

// ── Type annotation stripping ──────────────────────────────────────

/**
 * Given a position right after a variable name, skip a `: Type` annotation
 * by tracking balanced `{}`, `<>`, `()`, and `[]`. Returns the index right
 * after the type annotation ends (where `=`, `;`, newline, or EOF is).
 */
function skipTypeAnnotation(code: string, start: number): number {
	// Must start with optional whitespace then `:`
	let i = start;
	while (i < code.length && (code[i] === ' ' || code[i] === '\t')) i++;
	if (i >= code.length || code[i] !== ':') return start; // no type annotation
	i++; // skip the `:`

	let depth = 0; // tracks {} <> () [] nesting

	while (i < code.length) {
		const ch = code[i];
		if (ch === '{' || ch === '(' || ch === '[') {
			depth++;
		} else if (ch === '}' || ch === ')' || ch === ']') {
			if (depth === 0) break; // unbalanced close — end of type
			depth--;
		} else if (ch === '<') {
			// Could be a generic type angle bracket — only count if we're in a type context
			depth++;
		} else if (ch === '>') {
			if (depth === 0) break;
			depth--;
		} else if (depth === 0) {
			// At top level, `=` (not `=>`) ends the type
			if (ch === '=' && i + 1 < code.length && code[i + 1] !== '>') break;
			// `;` or newline at top level ends the type
			if (ch === ';' || ch === '\n') break;
		}
		i++;
	}

	return i;
}

/**
 * Transform `state varName: Type = expr` → `let $$s = 0, varName = expr`
 * Transform `state varName: Type` → `let $$s = 0, varName`
 * Properly handles balanced braces inside type annotations.
 */
function transformStateDeclarations(code: string, stateVars: string[], marker: string, insideComment: (offset: number) => boolean): string {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate\s+(\w+)/g;
	let result = '';
	let lastIndex = 0;
	let match;
	let counter = 0;

	while ((match = re.exec(code)) !== null) {
		if (insideComment(match.index)) continue;
		const exportKw = match[1] || '';
		const name = match[2];
		const matchEnd = match.index + match[0].length;

		// Validate: after `state name`, the next non-whitespace char must indicate a
		// declaration context (=, :, ;, newline, comma, close-paren, or EOF).
		// This prevents matching prose like "state and derived" inside strings.
		const afterType = skipTypeAnnotation(code, matchEnd);
		let peek = afterType;
		while (peek < code.length && (code[peek] === ' ' || code[peek] === '\t')) peek++;
		if (peek < code.length && !/[=;,)\n]/.test(code[peek])) continue;

		stateVars.push(name);
		result += code.slice(lastIndex, match.index);
		// Emit `let $$s0 = 0, name: Type = expr` — the $$s* sibling declarator marks this as state
		const typeText = code.slice(matchEnd, afterType);
		result += `${exportKw}let ${marker}${counter++} = 0, ${name}${typeText}`;
		lastIndex = afterType;
	}

	result += code.slice(lastIndex);
	return result;
}

/**
 * Transform `derived varName: Type = expr` → `const $$d = 0, varName = expr`
 * Properly handles balanced braces inside type annotations.
 */
function transformDerivedDeclarations(code: string, derivedVars: string[], marker: string, insideComment: (offset: number) => boolean): string {
	// Single pass: matches both `derived name` and `derived {pattern}`/`derived [pattern]`
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[\w{[])/g;
	let result = '';
	let lastIndex = 0;
	let match;
	let counter = 0;

	while ((match = re.exec(code)) !== null) {
		if (insideComment(match.index)) continue;
		const start = match.index;
		const exportKw = match[1] || '';
		const afterKeyword = start + exportKw.length + 'derived'.length;
		let cursor = skipWhitespace(code, afterKeyword);

		const nextChar = code[cursor];

		if (nextChar === '{' || nextChar === '[') {
			// Destructuring form: `derived { a, b } = expr` or `derived [a, b] = expr`
			const patternStart = cursor;
			const patternEnd = nextChar === '{'
				? findMatchingBrace(code, patternStart)
				: findMatchingBracket(code, patternStart);
			if (patternEnd === -1) continue;

			cursor = skipWhitespace(code, patternEnd + 1);
			if (code[cursor] !== '=') continue;

			const pattern = code.slice(patternStart, patternEnd + 1);
			collectPatternIdentifiers(pattern, derivedVars);

			result += code.slice(lastIndex, start);
			result += `${exportKw}const ${marker}${counter++} = 0,`;
			lastIndex = afterKeyword;
			re.lastIndex = lastIndex;
		} else {
			// Simple form: `derived name = expr` or `derived name: Type = expr`
			const nameMatch = code.slice(cursor).match(/^(\w+)/);
			if (!nameMatch) continue;
			const name = nameMatch[1];
			const matchEnd = cursor + name.length;

			const afterType = skipTypeAnnotation(code, matchEnd);
			let peek = afterType;
			while (peek < code.length && (code[peek] === ' ' || code[peek] === '\t')) peek++;
			if (peek < code.length && !/[=;,)\n]/.test(code[peek])) continue;

			derivedVars.push(name);
			result += code.slice(lastIndex, start);
			const typeText = code.slice(matchEnd, afterType);
			result += `${exportKw}const ${marker}${counter++} = 0, ${name}${typeText}`;
			lastIndex = afterType;
		}
	}

	result += code.slice(lastIndex);
	return result;
}

// ── Pre-process ────────────────────────────────────────────────────

export function preprocess(source: string): PreprocessResult {
	let code = source;
	const components: ComponentMeta[] = [];
	const stateVars: string[] = [];
	const derivedVars: string[] = [];

	// 0. Collect comment ranges so keyword regexes can skip matches inside them.
	// 0. Collect comment ranges so keyword regexes can skip matches inside them.
	//    This prevents e.g. `state variable` inside a JSDoc comment from being transformed.
	function buildCommentRanges(src: string): [number, number][] {
		const ranges: [number, number][] = [];
		src.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, (match, str, _comment, offset) => {
			if (!str) ranges.push([offset, offset + match.length]);
			return match;
		});
		return ranges;
	}
	let commentRanges = buildCommentRanges(code);
	function insideComment(offset: number): boolean {
		for (const [start, end] of commentRanges) {
			if (offset >= start && offset < end) return true;
			if (start > offset) break;
		}
		return false;
	}

	// 1. Transform component declarations
	//    Handles: [export] [default] [async] component Name(...)
	code = code.replace(
		/\b(export\s+)?(default\s+)?(async\s+)?component\s+(\w+)/g,
		(_match, exportKw, defaultKw, asyncKw, name, offset) => {
			if (insideComment(offset)) return _match;
			components.push({
				name,
				isExport: !!exportKw,
				isDefault: !!defaultKw,
				isAsync: !!asyncKw,
			});
			return `${exportKw || ''}${defaultKw || ''}${asyncKw || ''}function ${name}`;
		},
	);

	// 1b. Transform renamed params: 'ext-name' as localName → localName
	//     Store the external→local mapping per component so the analyzer can set externalName on ParamIR.
	const renamedParams: Record<string, Record<string, string>> = {};
	// Build a position → component name mapping from the component list
	// We search the *original* source for 'component Name(' to find positions
	const componentPositions: { name: string; start: number }[] = [];
	for (const comp of components) {
		const re = new RegExp(`\\bcomponent\\s+${comp.name}\\s*\\(`);
		const m = source.match(re);
		if (m && m.index != null) {
			componentPositions.push({ name: comp.name, start: m.index });
		}
	}
	componentPositions.sort((a, b) => a.start - b.start);

	code = code.replace(
		/(['"])([^'"]+)\1\s+as\s+(\w+)/g,
		(_match, _quote, externalName, localName, offset) => {
			const ownerComp = findOwnerComponent(componentPositions, offset);
			if (ownerComp) {
				if (!renamedParams[ownerComp]) renamedParams[ownerComp] = {};
				renamedParams[ownerComp][localName] = externalName;
			}
			return localName;
		},
	);

	// 1c. Transform `bind paramName` in function params → `__bind__paramName`
	//     so OXC can parse it as a valid identifier, and the analyzer can detect it.
	code = code.replace(/\bbind\s+(\w+)/g, '__bind__$1');

	// Recompute comment ranges after transforms may have shifted offsets.
	// Each transform that changes code length invalidates ranges, so we rebuild before each keyword pass.
	function rebuildCommentCheck() {
		commentRanges = buildCommentRanges(code);
	}

	// 2. Transform `state varName = expr` or `state varName: Type = expr` → `let $$s = 0, varName = expr`
	//    The $$s sibling declarator lets the analyzer identify this as a state declaration
	//    regardless of scope. Survives oxcTransformSync (unlike comment markers).
	rebuildCommentCheck();
	code = transformStateDeclarations(code, stateVars, STATE_MARKER, insideComment);

	// 3. Transform all `derived` forms (simple and destructuring) in source order
	rebuildCommentCheck();
	code = transformDerivedDeclarations(code, derivedVars, DERIVED_MARKER, insideComment);

	// 4. Transform all `render` forms into `return` statements:
	//    - `render (jsx)` → `return (<>jsx</>)`
	//    - `render <jsx>` → `return (<>jsx</>)`
	//    - `render expr`  → `return expr`
	code = transformRenders(code);

	// 4c. Extract <style> blocks from JSX before OXC parsing
	//     CSS braces { } would confuse the JSX parser, so remove them here.
	const styleBlocks: ExtractedStyleBlock[] = [];
	code = extractStyleBlocks(code, styleBlocks);

	// 5. Transform `bind:{x}` shorthand → `bind:value={x}`
	code = code.replace(/bind:\{(\w+)\}/g, 'bind:value={$1}');

	// 6. Wrap function bindings: `bind:prop={get, set}` → `bind:prop={[get, set]}`
	//    so OXC can parse them (JSX disallows the comma operator)
	code = wrapFunctionBindings(code);

	// 7. Transform control flow blocks ({if}, {for}) into parseable __if()/__for() calls
	code = transformControlFlowBlocks(code);

	return { code, components, stateVars, derivedVars, renamedParams, styleBlocks };
}

// ── Function binding wrapper ───────────────────────────────────────

// ── Style block extraction ─────────────────────────────────────────

/**
 * Extract `<style>` and `<style global>` blocks from the source code.
 * Removes them and replaces with whitespace to preserve offsets.
 * Returns the modified code and populates the blocks array.
 */
function extractStyleBlocks(code: string, blocks: ExtractedStyleBlock[]): string {
	// Match <style> or <style global> tags
	const styleOpenRegex = /<style(\s+global)?\s*>/g;
	let match;
	let result = '';
	let lastIndex = 0;

	while ((match = styleOpenRegex.exec(code)) !== null) {
		const isGlobal = !!match[1];
		const openTagStart = match.index;
		const openTagEnd = openTagStart + match[0].length;

		// Find the closing </style> tag
		const closeTag = '</style>';
		const closeIdx = code.indexOf(closeTag, openTagEnd);
		if (closeIdx === -1) continue;

		const css = code.slice(openTagEnd, closeIdx);
		const fullEnd = closeIdx + closeTag.length;

		const markerName = `${STYLE_MARKER_PREFIX}${blocks.length}`;
		blocks.push({
			css,
			isGlobal,
			markerName,
		});

		// Replace the entire <style>...</style> with a marker JSX element
		// that survives oxcTransformSync and can be found in the AST
		result += code.slice(lastIndex, openTagStart);
		result += `<${markerName} />`;
		lastIndex = fullEnd;
		styleOpenRegex.lastIndex = fullEnd;
	}

	result += code.slice(lastIndex);
	return result;
}

/**
 * Finds `bind:prop={expr1, expr2}` and wraps as `bind:prop={[expr1, expr2]}`
 * so OXC doesn't reject the comma operator inside JSX.
 */
function wrapFunctionBindings(code: string): string {
	const bindRegex = /bind:\w+\s*=\s*\{/g;
	let match;
	let result = '';
	let lastIndex = 0;

	while ((match = bindRegex.exec(code)) !== null) {
		const openBrace = match.index + match[0].length - 1;
		const closeBrace = findMatchingBrace(code, openBrace);
		if (closeBrace === -1) continue;

		const inner = code.slice(openBrace + 1, closeBrace);
		if (hasTopLevelComma(inner)) {
			result += code.slice(lastIndex, openBrace + 1);
			result += `[${inner}]`;
			result += '}';
			lastIndex = closeBrace + 1;
		}
	}

	result += code.slice(lastIndex);
	return result;
}

function hasTopLevelComma(expr: string): boolean {
	let depth = 0;
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === ',' && depth === 0) return true;
		else if (ch === '\'' || ch === '"') {
			i = skipString(expr, i) - 1;
		} else if (ch === '`') {
			i = skipTemplateLiteral(expr, i) - 1;
		}
	}
	return false;
}

// ── Render transformation ──────────────────────────────────────────

/**
 * Unified render transformer. Handles all three forms:
 *   render (jsx)   → return (<>jsx</>)
 *   render <jsx>   → return (<>jsx</>)
 *   render expr    → return expr
 *
 * Single character-walking pass, skipping strings/templates.
 */
function transformRenders(code: string): string {
	let result = '';
	let i = 0;

	while (i < code.length) {
		// Skip comments
		if (code[i] === '/' && code[i + 1] === '/') {
			const end = skipLineComment(code, i);
			result += code.slice(i, end);
			i = end;
			continue;
		}
		if (code[i] === '/' && code[i + 1] === '*') {
			const end = skipBlockComment(code, i);
			result += code.slice(i, end);
			i = end;
			continue;
		}
		// Skip strings and templates
		if (code[i] === "'" || code[i] === '"') {
			const end = skipString(code, i);
			result += code.slice(i, end);
			i = end;
			continue;
		}
		if (code[i] === '`') {
			const end = skipTemplateLiteral(code, i);
			result += code.slice(i, end);
			i = end;
			continue;
		}

		// Look for `render` keyword (word boundary, not member access)
		if (
			code.slice(i, i + 6) === 'render' &&
			(i === 0 || (!/\w/.test(code[i - 1]) && code[i - 1] !== '.')) &&
			/[\s(<]/.test(code[i + 6] || '')
		) {
			let j = i + 6;
			// Skip whitespace between `render` and the expression
			while (j < code.length && /[ \t]/.test(code[j])) j++;

			if (code[j] === '(') {
				// render (...) → return (...) preserving parens
				const closePos = findMatchingParen(code, j);
				const content = code.slice(j + 1, closePos);
				const inner = transformRenders(content);
				if (isSingleJSXRoot(inner)) {
					result += `return (${inner})`;
				} else {
					result += `return (<>${inner}</>)`;
				}
				i = closePos + 1;
				continue;
			} else if (code[j] === '<') {
				// render <jsx> → return jsx (no parens)
				const jsxEnd = findJSXElementEnd(code, j);
				if (jsxEnd > j) {
					const jsx = code.slice(j, jsxEnd);
					result += `return ${transformRenders(jsx)}`;
					i = jsxEnd;
					continue;
				}
			} else if (code[j] && code[j] !== '{') {
				// render expr → return expr
				const exprEnd = findExpressionEnd(code, j);
				let expr = code.slice(j, exprEnd).replace(/[\s;]+$/, '');
				result += `return ${expr}`;
				i = exprEnd;
				continue;
			}
		}

		result += code[i];
		i++;
	}

	return result;
}

/**
 * Find the end of an expression statement for `render expr`.
 * Tracks parens/brackets depth; ends at `;` or newline at depth 0.
 */
function findExpressionEnd(code: string, start: number): number {
	let i = start;
	let depth = 0;

	while (i < code.length) {
		const ch = code[i];
		if (ch === '(' || ch === '[') { depth++; i++; continue; }
		if (ch === ')' || ch === ']') { depth--; i++; continue; }
		if (ch === "'" || ch === '"') { i = skipString(code, i); continue; }
		if (ch === '`') { i = skipTemplateLiteral(code, i); continue; }
		if (ch === ';') return i + 1;
		if (ch === '\n' && depth === 0) return i;
		i++;
	}
	return i;
}

/**
 * Check if JSX content has a single root element (no fragment needed).
 * Returns true if there's exactly one top-level JSX element after trimming whitespace.
 */
function isSingleJSXRoot(code: string): boolean {
	const trimmed = code.trim();
	if (!trimmed.startsWith('<')) return false;
	const end = findJSXElementEnd(trimmed, 0);
	if (end <= 0) return false;
	// Check if everything after the element is just whitespace
	return trimmed.slice(end).trim() === '';
}

/**
 * Finds the end position (exclusive) of a single JSX element starting at `<`.
 * Handles self-closing (`<br />`), paired tags (`<p>...</p>`), and nested
 * elements/expression containers.
 */
function findJSXElementEnd(code: string, start: number): number {
	let i = start + 1; // skip `<`

	// Read tag name (supports dotted components like Foo.Bar)
	const tagStart = i;
	while (i < code.length && /[\w.$]/.test(code[i])) i++;
	const tagName = code.slice(tagStart, i);
	if (!tagName) return start; // not a valid tag

	// Skip opening tag attributes until `>` or `/>`
	while (i < code.length) {
		if (code[i] === '/' && code[i + 1] === '>') return i + 2; // self-closing
		if (code[i] === '>') { i++; break; }
		if (code[i] === '{') { i = skipJSXExpr(code, i); continue; }
		if (code[i] === "'" || code[i] === '"') { i = skipString(code, i); continue; }
		i++;
	}

	// Find matching closing tag </tagName>
	let nesting = 1;
	while (i < code.length && nesting > 0) {
		if (code[i] === '<') {
			if (code[i + 1] === '/') {
				// Closing tag
				const ns = i + 2;
				let ne = ns;
				while (ne < code.length && /[\w.$]/.test(code[ne])) ne++;
				if (code.slice(ns, ne) === tagName) {
					nesting--;
					if (nesting === 0) {
						while (ne < code.length && code[ne] !== '>') ne++;
						return ne + 1;
					}
				}
				i = ne;
			} else {
				// Potential opening tag of same name
				const ns = i + 1;
				let ne = ns;
				while (ne < code.length && /[\w.$]/.test(code[ne])) ne++;
				if (code.slice(ns, ne) === tagName) {
					// Check if self-closing
					if (!isSelfClosingTag(code, ne)) nesting++;
				}
				i = ne;
			}
			continue;
		}
		if (code[i] === '{') { i = skipJSXExpr(code, i); continue; }
		i++;
	}
	return i;
}

/** Skip a JSX expression container { ... } tracking brace depth */
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

/** Check if a tag at the given attribute-start position is self-closing */
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

// ── Helper: find matching parenthesis ──────────────────────────────

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
		i++;
	}
	return i - 1;
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

// ── Parse with OXC ─────────────────────────────────────────────────

export function parse(filename: string, code: string, lang: 'tsx' | 'jsx' = 'tsx') {
	return oxcParseSync(filename, code, { sourceType: 'module', lang });
}

function transformDerivedDestructuring(code: string, derivedVars: string[], insideComment: (offset: number) => boolean, startCounter = 0): { code: string; counter: number } {
	const derivedRegex = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[{[])/g;
	let match: RegExpExecArray | null;
	let result = '';
	let lastIndex = 0;
	let counter = startCounter;

	while ((match = derivedRegex.exec(code)) !== null) {
		if (insideComment(match.index)) continue;
		const start = match.index;
		const exportKw = match[1] || '';
		let cursor = skipWhitespace(code, start + exportKw.length + 'derived'.length);

		const patternStart = cursor;
		const open = code[patternStart];
		if (open !== '{' && open !== '[') continue;

		const patternEnd = open === '{'
			? findMatchingBrace(code, patternStart)
			: findMatchingBracket(code, patternStart);
		if (patternEnd === -1) continue;

		cursor = skipWhitespace(code, patternEnd + 1);
		if (code[cursor] !== '=') continue;

		// Collect variable names from the pattern for the derivedVars list
		const pattern = code.slice(patternStart, patternEnd + 1);
		collectPatternIdentifiers(pattern, derivedVars);

		// Simple replacement: `derived { a, b } = expr` → `const $$d0 = 0, { a, b } = expr`
		result += code.slice(lastIndex, start);
		result += `${exportKw}const ${DERIVED_MARKER}${counter++} = 0,`;
		lastIndex = start + exportKw.length + 'derived'.length;
		derivedRegex.lastIndex = lastIndex;
	}

	result += code.slice(lastIndex);
	return { code: result, counter };
}

function collectPatternIdentifiers(pattern: string, names: string[]): void {
	// Extract all identifiers from a destructuring pattern using simple regex
	// Handles { a, b: c, ...rest } and [x, , y, ...rest]
	const re = /(?:\.\.\.)?(\w+)\s*(?:[:,=}\])]|$)/g;
	let m;
	while ((m = re.exec(pattern)) !== null) {
		const name = m[1];
		if (name && name !== 'undefined') names.push(name);
	}
}


function skipWhitespace(code: string, index: number): number {
	let i = index;
	while (i < code.length && /\s/.test(code[i])) i++;
	return i;
}

// ── Control flow block transformation ──────────────────────────────

/**
 * Wrap a body string as an arrow function.
 * Maps 1:1 to arrow function semantics — the body IS the arrow body:
 * - `{ stmts }` → `() => { stmts }`
 * - `(expr)` → `() => (expr)`
 * - `<jsx/>` → `() => (<><jsx/></>)`
 * - `expr` → `() => (expr)`
 *
 * Special cases:
 * - Block with `return` (from `render`) but missing outer braces → wraps in `{ }`
 * - Nested CF statement → recursively transforms and fragment-wraps
 */
function buildCFCallback(body: string, params?: string): string {
	const arrow = params ? `(${params}) =>` : `() =>`;
	const trimmed = body.trim();

	// Block body: `{ ... }` → `() => { ... }`
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		const inner = trimmed.slice(1, -1).trim();
		// Block containing only a CF statement → transform to expression body
		if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(inner)) {
			const transformed = transformControlFlowBlocks(`{${inner}}`);
			return `${arrow} (${transformed.slice(1, -1).trim()})`;
		}
		return `${arrow} ${body}`;
	}

	// Nested CF statement → transform to expression
	if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(trimmed)) {
		const transformed = transformControlFlowBlocks(`{${body}}`);
		// transformed is `{__if(...)}` — extract the inner expression
		return `${arrow} ${transformed.slice(1, -1).trim()}`;
	}

	// Bare JSX → fragment-wrap only if multiple roots
	if (trimmed.startsWith('<')) {
		if (isSingleJSXRoot(body)) {
			return `${arrow} ${body.trim()}`;
		}
		return `${arrow} (<>${body}</>)`;
	}

	// Paren-wrapped expression (from paren bodies) → pass through
	if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
		return `${arrow} ${trimmed}`;
	}

	// Expression
	return `${arrow} (${body})`;
}

interface ControlFlowResult {
	text: string;
	end: number;
}

function transformControlFlowBlocks(code: string): string {
	let result = '';
	let i = 0;

	while (i < code.length) {
		// Skip strings
		if (code[i] === "'" || code[i] === '"') {
			const end = skipString(code, i);
			result += code.slice(i, end);
			i = end;
			continue;
		}
		if (code[i] === '`') {
			const end = skipTemplateLiteral(code, i);
			result += code.slice(i, end);
			i = end;
			continue;
		}

		if (code[i] === '{') {
			// {@html expr} → {__html(expr)}
			const htmlMatch = code.slice(i).match(/^\{@html\s+/);
			if (htmlMatch) {
				const exprStart = i + htmlMatch[0].length;
				const closeBrace = findMatchingBrace(code, i);
				if (closeBrace > exprStart) {
					const expr = code.slice(exprStart, closeBrace).trim();
					result += `{__html(${expr})}`;
					i = closeBrace + 1;
					continue;
				}
			}

			const parsed = tryParseJSXBlock(code, i);
			if (parsed) {
				result += parsed.text;
				i = parsed.end;
				continue;
			}
		}

		result += code[i];
		i++;
	}

	return result;
}

/**
 * Tries to parse a `{...}` block as a JSX expression container.
 *
 * `{}` in JSX is an escape hatch: simple expressions (`{count}`, `{<p/>}`)
 * pass through unchanged for OXC to handle. Anything with statements
 * (CF keywords or variable declarations) gets transformed:
 *
 * - `{if/for/switch/try ...}` → direct CF call (`{__if(...)}` etc.)
 * - `{ stmts; render/CF/<jsx> }` → `{__block(() => { stmts; return ... })}`
 *
 * Returns null for non-JSX braces (function bodies, arrow bodies, else, etc.).
 */
function tryParseJSXBlock(code: string, openBrace: number): ControlFlowResult | null {
	// Skip non-JSX braces: function bodies, arrow bodies, else blocks, case labels
	let k = openBrace - 1;
	while (k >= 0 && /\s/.test(code[k])) k--;
	if (k >= 0) {
		const pc = code[k];
		if (pc === ')') return null;                                     // function/if/for body
		if (pc === '>' && k > 0 && code[k - 1] === '=') return null;    // arrow body
		// case/label body: only treat `:` as non-JSX when preceded by a case expression
		// or a bare identifier (label). Not when `:` is just text content (e.g. `{text}:`)
		if (pc === ':') {
			// Look before the `:` for `case ...` or a label identifier
			let t = k - 1;
			while (t >= 0 && /\s/.test(code[t])) t--;
			if (t >= 0) {
				// `'val':` or `"val":` — case with string literal
				if (code[t] === "'" || code[t] === '"') return null;
				// `identifier:` — could be a label. Check it's a simple identifier preceded by start/newline/;/}
				if (/\w/.test(code[t])) {
					let idEnd = t;
					while (t >= 0 && /\w/.test(code[t])) t--;
					const word = code.slice(t + 1, idEnd + 1);
					// `case` keyword: `case expr:`
					if (word === 'case') return null;
					// `default:`
					if (word === 'default') return null;
					// Check for `case ... expr:` by scanning back further for `case` keyword
					let s = t;
					while (s >= 0 && /\s/.test(code[s])) s--;
					// Label: identifier at start of line or after ; or }
					if (s < 0 || code[s] === ';' || code[s] === '}' || code[s] === '{' || code[s] === '\n') return null;
					// Could be `case someExpr:` — scan back for the case keyword
					const lineStart = code.lastIndexOf('\n', k);
					const lineBefore = code.slice(lineStart + 1, k + 1).trim();
					if (/^case\b/.test(lineBefore)) return null;
				}
			}
		}
		if (/\belse$/.test(code.slice(Math.max(0, k - 4), k + 1))) return null;
		if (/\btry$/.test(code.slice(Math.max(0, k - 2), k + 1))) return null;

		// Return type annotation: `): Type {` or `): Type<T> {`
		// Scan backward past the type (identifiers, dots, generics, arrays, unions)
		// and check if we ultimately find `)` which indicates a function body.
		if (/[\w\]>}]/.test(pc)) {
			let t = k;
			while (t >= 0) {
				if (/[\w.$]/.test(code[t])) { t--; continue; }
				if (code[t] === '|' || code[t] === '&') { t--; continue; }  // union/intersection
				if (/\s/.test(code[t])) { t--; continue; }
				if (code[t] === ']' && t > 0 && code[t - 1] === '[') { t -= 2; continue; } // array type
				if (code[t] === '>') {
					// Skip generic angle brackets: find matching <
					let depth = 1;
					t--;
					while (t >= 0 && depth > 0) {
						if (code[t] === '>') depth++;
						else if (code[t] === '<') depth--;
						t--;
					}
					continue;
				}
				if (code[t] === '}') {
					// Skip object type braces: find matching {
					let depth = 1;
					t--;
					while (t >= 0 && depth > 0) {
						if (code[t] === '}') depth++;
						else if (code[t] === '{') depth--;
						t--;
					}
					continue;
				}
				if (code[t] === ')') {
					// Skip parenthesized types / function type params: find matching (
					let depth = 1;
					t--;
					while (t >= 0 && depth > 0) {
						if (code[t] === ')') depth++;
						else if (code[t] === '(') depth--;
						t--;
					}
					continue;
				}
				break;
			}
			// After scanning past the type, check for `: )` pattern (return type annotation)
			while (t >= 0 && /\s/.test(code[t])) t--;
			if (t >= 0 && code[t] === ':') {
				t--;
				while (t >= 0 && /\s/.test(code[t])) t--;
				if (t >= 0 && code[t] === ')') return null;              // function body with return type
			}
		}
	}

	const outerClose = findMatchingBrace(code, openBrace);
	const content = code.slice(openBrace + 1, outerClose).trim();
	if (!content) return null;

	// Skip past whitespace to see what the content starts with
	let j = 0;
	while (j < content.length && /\s/.test(content[j])) j++;
	const rest = content.slice(j);

	// ── Case 1: CF keyword at top level → direct CF call ──
	if (/^if\s*\(/.test(rest)) return tryParseIfBlock(code, openBrace);
	if (/^for\s*\(/.test(rest)) return tryParseForBlock(code, openBrace);
	if (/^switch\s*\(/.test(rest)) return tryParseSwitchBlock(code, openBrace);
	if (/^try\s*[({]/.test(rest)) return tryParseTryBlock(code, openBrace);

	// ── Case 2: Block scope (starts with variable declaration) ──
	if (/^(?:const |let |var )/.test(rest)) {
		return tryParseBlock(content, outerClose);
	}

	// ── Case 3: Single expression → pass through to OXC ──
	return null;
}

/**
 * Parses a block scope `{ stmts; body }` where body is render/CF.
 *
 * By the time we get here, `render <jsx>` has already become `return (<>jsx</>)`
 * from step 4b. We split the content into preamble statements and a trailing
 * body (CF keyword or return), then emit `__block(() => { ... })`.
 */
function tryParseBlock(content: string, outerClose: number): ControlFlowResult | null {
	// Scan for where the body starts: the first top-level CF keyword
	// or `return` (from render).
	let bodyIdx = -1;
	let i = 0;
	while (i < content.length) {
		const ch = content[i];
		if (ch === "'" || ch === '"') { i = skipString(content, i); continue; }
		if (ch === '`') { i = skipTemplateLiteral(content, i); continue; }
		if (ch === '{') { i = findMatchingBrace(content, i) + 1; continue; }
		if (ch === '(') { i = findMatchingParen(content, i) + 1; continue; }

		const tail = content.slice(i);
		const wb = i === 0 || !/\w/.test(content[i - 1]);
		if (wb && /^(?:if\s*\(|for\s*\(|switch\s*\(|try\s*[({]|return[\s(])/.test(tail)) { bodyIdx = i; break; }
		i++;
	}
	if (bodyIdx === -1) return null;

	let preamble = content.slice(0, bodyIdx).trim();
	const body = content.slice(bodyIdx).trim();
	if (!preamble) return null;

	// Ensure preamble ends with `;` to avoid ASI issues
	if (!preamble.endsWith(';')) preamble += ';';

	let finalBody: string;
	if (body.startsWith('return')) {
		// From `render` (step 4/4b) — already a return statement
		finalBody = body;
	} else if (/^(?:if|for|switch|try)\b/.test(body)) {
		// CF keyword — transform through CF handlers, wrap result as return
		const transformed = transformControlFlowBlocks(`{${body}}`);
		finalBody = `return (<>${transformed}</>)`;
	} else {
		return null;
	}

	return { text: `{__block(() => { ${preamble} ${finalBody} })}`, end: outerClose + 1 };
}

/**
 * Extract a branch body starting at position `pos` in `text`.
 * Returns the raw body text ready to be passed to `buildCFCallback`.
 */
function extractBody(text: string, pos: number): { body: string; end: number; closeIndent?: string } | null {
	if (pos >= text.length) return null;
	const ch = text[pos];

	if (ch === '{') {
		const close = findMatchingBrace(text, pos);
		return { body: text.slice(pos, close + 1), end: close + 1 };
	}

	if (ch === '(') {
		const close = findMatchingParen(text, pos);
		const raw = text.slice(pos + 1, close);
		const trimmed = raw.trim();
		// Detect if closing ) was on its own line (trailing whitespace contains newline)
		const lastNL = raw.lastIndexOf('\n');
		let closeIndent: string | undefined;
		if (lastNL >= 0) {
			const trailing = raw.slice(lastNL + 1);
			if (/^\s*$/.test(trailing)) {
				closeIndent = trailing;
			}
		}
		if (trimmed.startsWith('<') && !isSingleJSXRoot(trimmed)) {
			return { body: `(<>${raw}</>)`, end: close + 1, closeIndent };
		}
		return { body: `(${raw})`, end: close + 1, closeIndent };
	}

	if (ch === '<') {
		const end = findJSXElementEnd(text, pos);
		return { body: text.slice(pos, end), end };
	}

	const end = findExpressionEnd(text, pos);
	return { body: text.slice(pos, end), end };
}

function tryParseIfBlock(code: string, outerBrace: number): ControlFlowResult | null {
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('if')) return null;

	// Recursively transform nested control flow blocks first.
	const transformed = transformControlFlowBlocks(content);

	// Text-based parsing — no OXC needed.
	// The body after `if (cond)` maps 1:1 to an arrow function body.
	const output = parseIfChain(transformed);
	if (!output) return null;

	return { text: `{${output}}`, end: outerClose + 1 };
}

/**
 * Parse an if/else-if/else chain by text scanning.
 * Returns the `__if(...)` call string.
 */
function parseIfChain(text: string): string | null {
	let pos = 0;

	// Skip `if`
	if (text.slice(pos, pos + 2) !== 'if') return null;
	pos += 2;
	while (pos < text.length && /\s/.test(text[pos])) pos++;

	// Extract condition
	if (text[pos] !== '(') return null;
	const condEnd = findMatchingParen(text, pos);
	const condition = text.slice(pos + 1, condEnd);
	pos = condEnd + 1;
	while (pos < text.length && /\s/.test(text[pos])) pos++;

	// Extract consequent body
	const trueBranch = extractBody(text, pos);
	if (!trueBranch) return null;
	pos = trueBranch.end;
	while (pos < text.length && /\s/.test(text[pos])) pos++;

	// Check for else
	if (pos < text.length && text.slice(pos, pos + 4) === 'else' && !/\w/.test(text[pos + 4] || '')) {
		pos += 4;
		while (pos < text.length && /\s/.test(text[pos])) pos++;

		// else if → recurse
		if (text.slice(pos, pos + 2) === 'if') {
			const nestedCall = parseIfChain(text.slice(pos));
			if (!nestedCall) return null;
			return `__if(() => (${condition}), ${buildCFCallback(trueBranch.body)}, () => ${nestedCall})`;
		}

		// else body
		const falseBranch = extractBody(text, pos);
		if (!falseBranch) return null;
		return `__if(() => (${condition}), ${buildCFCallback(trueBranch.body)}, ${buildCFCallback(falseBranch.body)})`;
	}

	// No else — closing stays inline
	return `__if(() => (${condition}), ${buildCFCallback(trueBranch.body)})`;
}

function tryParseForBlock(code: string, outerBrace: number): ControlFlowResult | null {
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('for')) return null;

	// Find the header parentheses: for (...)
	const parenStart = content.indexOf('(');
	if (parenStart === -1) return null;
	const parenEnd = findMatchingParen(content, parenStart);
	const fullHeader = content.slice(parenStart + 1, parenEnd).trim();

	// Extract body (everything after the header parens), keep braces if present
	const bodyText = content.slice(parenEnd + 1).trim();
	let transformedBody: string;
	if (bodyText.startsWith('{') && bodyText.endsWith('}')) {
		const inner = bodyText.slice(1, -1); // preserve whitespace
		const trimmedInner = inner.trim();
		// Check if body is only a CF statement (if/for/switch/try)
		if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(trimmedInner)) {
			// Transform the CF statement, preserving surrounding whitespace
			const transformed = transformControlFlowBlocks(`{${trimmedInner}}`);
			const cfExpr = transformed.slice(1, -1); // remove outer { }
			const startIdx = inner.indexOf(trimmedInner);
			transformedBody = `{${inner.slice(0, startIdx)}${cfExpr}${inner.slice(startIdx + trimmedInner.length)}}`;
		} else {
			transformedBody = `{${transformControlFlowBlocks(inner)}}`;
		}
	} else {
		transformedBody = transformControlFlowBlocks(bodyText);
	}

	// Try parsing the full header to determine loop type
	const forSource = `for (${fullHeader}) {}`;
	const fullResult = oxcParseSync('for-block.tsx', forSource, {
		sourceType: 'script',
		lang: 'tsx',
	});

	if (fullResult.errors.length === 0 && fullResult.program.body.length > 0) {
		const forStmt = fullResult.program.body[0];

		// for...in: for (const key in obj)
		if (forStmt.type === 'ForInStatement') {
			const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
			const objectExpr = forSource.slice(forStmt.right.start, forStmt.right.end);
			const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');
			const text = `{__for(() => (Object.keys(${objectExpr})), ${buildCFCallback(transformedBody, paramPattern)})}`;
			return { text, end: outerClose + 1 };
		}

		// C-style for: for (let i = 0; i < 10; i++)
		if (forStmt.type === 'ForStatement') {
			const initSrc = forStmt.init ? forSource.slice(forStmt.init.start, forStmt.init.end) : '';
			const testSrc = forStmt.test ? forSource.slice(forStmt.test.start, forStmt.test.end) : '';
			const updateSrc = forStmt.update ? forSource.slice(forStmt.update.start, forStmt.update.end) : '';

			// Extract loop variable name from init
			let loopVar = '__i';
			if (forStmt.init && forStmt.init.type === 'VariableDeclaration') {
				const firstDecl = forStmt.init.declarations[0];
				if (firstDecl && firstDecl.id.type === 'Identifier') {
					loopVar = firstDecl.id.name;
				}
			} else if (forStmt.init && forStmt.init.type === 'AssignmentExpression') {
				if (forStmt.init.left.type === 'Identifier') {
					loopVar = forStmt.init.left.name;
				}
			}

			const collectionFn = `{ const __a = []; for (${initSrc}; ${testSrc}; ${updateSrc}) __a.push(${loopVar}); return __a; }`;
			const text = `{__for(() => ${collectionFn}, ${buildCFCallback(transformedBody, loopVar)})}`;
			return { text, end: outerClose + 1 };
		}

		// for...of without extensions
		if (forStmt.type === 'ForOfStatement') {
			const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
			const collection = forSource.slice(forStmt.right.start, forStmt.right.end);
			const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');
			const text = `{__for(() => (${collection}), ${buildCFCallback(transformedBody, paramPattern)})}`;
			return { text, end: outerClose + 1 };
		}
	}

	// Full header didn't parse — try for-of with DarTsx extensions (index, key)
	const parts = fullHeader.split(';').map((s) => s.trim());
	const mainPart = parts[0];

	let indexName: string | null = null;
	let keyExpr: string | null = null;
	for (let k = 1; k < parts.length; k++) {
		const part = parts[k];
		if (part.startsWith('index ')) indexName = part.slice(6).trim();
		else if (part.startsWith('key ')) keyExpr = part.slice(4).trim();
	}

	const forOfSource = `for (${mainPart}) {}`;
	const forOfResult = oxcParseSync('for-block.tsx', forOfSource, {
		sourceType: 'script',
		lang: 'tsx',
	});
	if (forOfResult.errors.length > 0 || forOfResult.program.body.length === 0) return null;

	const forOfStmt = forOfResult.program.body[0];
	if (forOfStmt.type !== 'ForOfStatement') return null;

	const leftSource = forOfSource.slice(forOfStmt.left.start, forOfStmt.left.end);
	const collection = forOfSource.slice(forOfStmt.right.start, forOfStmt.right.end);
	const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');

	const params = indexName ? `${paramPattern}, ${indexName}` : paramPattern;
	let text: string;
	const callback = buildCFCallback(transformedBody, params);
	if (keyExpr) {
		// Detect indentation from outer brace position for multiline formatting
		const lineStart = code.lastIndexOf('\n', outerBrace);
		const outerIndent = lineStart >= 0 ? (code.slice(lineStart + 1, outerBrace).match(/^(\s*)/) || ['', ''])[1] : '';
		const bodyIndent = outerIndent + '  ';
		text = `{__for(() => (${collection}), ${callback},\n${bodyIndent}(${paramPattern}) => (${keyExpr})\n${outerIndent})}`;
	} else {
		text = `{__for(() => (${collection}), ${callback})}`;
	}

	return { text, end: outerClose + 1 };
}

function tryParseSwitchBlock(code: string, outerBrace: number): ControlFlowResult | null {
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('switch')) return null;

	// Detect close indent from the outer brace position
	const outerLineStart = code.lastIndexOf('\n', outerBrace);
	const closeIndent = outerLineStart >= 0 ? (code.slice(outerLineStart + 1, outerBrace).match(/^(\s*)/) || ['', ''])[1] : '';

	// Recursively transform nested control flow blocks first
	const transformed = transformControlFlowBlocks(content);

	// Parse the transformed switch statement with OXC.
	// If cases contain `return` (from block-render), wrap in a function.
	let source = transformed;
	let result = oxcParseSync('switch-block.tsx', source, {
		sourceType: 'script',
		lang: 'tsx',
	});
	if (result.errors.length > 0) {
		source = `function __(){${transformed}}`;
		result = oxcParseSync('switch-block.tsx', source, { sourceType: 'script', lang: 'tsx' });
		if (result.errors.length > 0) return null;
		const fnDecl = result.program.body[0];
		if (!fnDecl || fnDecl.type !== 'FunctionDeclaration') return null;
		if (!fnDecl.body) return null;
		const firstStmt = fnDecl.body.body[0];
		if (!firstStmt || firstStmt.type !== 'SwitchStatement') return null;
		const discriminant = source.slice(firstStmt.discriminant.start, firstStmt.discriminant.end);
		return buildSwitchOutput(source, firstStmt, discriminant, outerClose, closeIndent);
	}

	const firstStmt = result.program.body[0];
	if (!firstStmt || firstStmt.type !== 'SwitchStatement') return null;

	const discriminant = source.slice(firstStmt.discriminant.start, firstStmt.discriminant.end);
	return buildSwitchOutput(source, firstStmt, discriminant, outerClose, closeIndent);
}

function buildSwitchOutput(source: string, switchStmt: SwitchStatement, discriminant: string, outerClose: number, closeIndent: string): ControlFlowResult {
	const switchCases = switchStmt.cases || [];

	// Group cases with fall-through support
	const groups: { values: string[]; isDefault: boolean; body: string; bodyPrefix: string }[] = [];
	let pendingValues: string[] = [];
	let pendingDefault = false;

	for (let ci = 0; ci < switchCases.length; ci++) {
		const sc = switchCases[ci];

		if (sc.test) {
			pendingValues.push(source.slice(sc.test.start, sc.test.end));
		} else {
			pendingDefault = true;
		}

		const consequent = sc.consequent || [];
		const bodyStmts = consequent.filter((s) => s.type !== 'BreakStatement' && s.type !== 'ReturnStatement');
		const hasBreak = consequent.some((s) => s.type === 'BreakStatement');
		const hasReturn = consequent.some((s) => s.type === 'ReturnStatement');
		const isLast = ci === switchCases.length - 1;

		// A case terminates its group if it has body content, a break/return, or is the last case
		if (bodyStmts.length > 0 || hasBreak || hasReturn || isLast) {
			let body = '';
			let bodyPrefix = '';
			// For block-render: include the return statement in the body
			const allBodyStmts = hasReturn
				? consequent.filter((s) => s.type !== 'BreakStatement')
				: bodyStmts;
			if (allBodyStmts.length > 0) {
				const start = allBodyStmts[0].start;
				const end = allBodyStmts[allBodyStmts.length - 1].end;
				body = source.slice(start, end);
				// Capture leading whitespace (newline + indent) before body
				const caseEnd = sc.test ? sc.test.end : sc.start + 7; // after 'default'
				const between = source.slice(caseEnd, start);
				const nlIdx = between.indexOf('\n');
				if (nlIdx >= 0) {
					bodyPrefix = between.slice(nlIdx);
				}
			}

			groups.push({
				values: [...pendingValues],
				isDefault: pendingDefault,
				body: body.trim(),
				bodyPrefix,
			});
			pendingValues = [];
			pendingDefault = false;
		}
	}

	// Detect indentation from first case in source
	let caseIndent = '  ';
	if (switchCases.length > 0) {
		const firstStart = switchCases[0].start;
		const lineStart = source.lastIndexOf('\n', firstStart);
		if (lineStart >= 0) {
			const linePrefix = source.slice(lineStart + 1, firstStart);
			const m = linePrefix.match(/^(\s*)/);
			if (m) caseIndent = m[1];
		}
	}
	const bodyIndent = caseIndent + '  ';

	// Build __switch call: discriminant fn, then pairs of (values, body fn)
	const discArg = `() => (${discriminant})`;
	const cases: string[] = [];
	for (const g of groups) {
		const valuesStr = g.isDefault ? 'null' : `[${g.values.join(', ')}]`;
		// Case bodies with statements (from `render` → `return`) need braces
		let body = g.body;
		if (/\breturn\b/.test(body)) {
			// Normalize indentation: dedent to base, reindent with detected indent
			const lines = body.split('\n').map(l => l.trimStart());
			body = `{\n${bodyIndent}${lines.join('\n' + bodyIndent)}\n${caseIndent}}`;
			cases.push(`${valuesStr}, ${buildCFCallback(body)}`);
		} else if (g.bodyPrefix && body.startsWith('<')) {
			// Bare JSX on its own line — preserve the line break + indent from source
			cases.push(`${valuesStr}, () =>${g.bodyPrefix}${body}`);
		} else {
			cases.push(`${valuesStr}, ${buildCFCallback(body)}`);
		}
	}

	const output = `__switch(${discArg},\n${caseIndent}${cases.join(',\n' + caseIndent)}\n${closeIndent})`;
	return { text: `{${output}}`, end: outerClose + 1 };
}

function tryParseTryBlock(code: string, outerBrace: number): ControlFlowResult | null {
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('try')) return null;

	// Manually parse: try {/( ... }/)} [pending {/( ... }/) ] [catch (param) {/( ... }/)]
	// Can't use OXC because "pending { }" isn't valid JavaScript
	// Supports both block `{ }` and expression `( )` delimiters
	let pos = 3; // skip "try"
	while (pos < content.length && /\s/.test(content[pos])) pos++;

	let tryBody: string;
	if (content[pos] === '{') {
		const tryBodyEnd = findMatchingBrace(content, pos);
		tryBody = content.slice(pos, tryBodyEnd + 1);
		pos = tryBodyEnd + 1;
	} else if (content[pos] === '(') {
		const tryBodyEnd = findMatchingParen(content, pos);
		tryBody = content.slice(pos + 1, tryBodyEnd).trim();
		pos = tryBodyEnd + 1;
	} else {
		return null;
	}

	let catchParam: string | null = null;
	let catchBody: string | null = null;
	let pendingBody: string | null = null;

	// Look for pending and catch blocks (in any order)
	while (pos < content.length) {
		while (pos < content.length && /\s/.test(content[pos])) pos++;
		if (pos >= content.length) break;

		const remaining = content.slice(pos);

		if (remaining.startsWith('pending')) {
			pos += 7;
			while (pos < content.length && /\s/.test(content[pos])) pos++;
			if (content[pos] === '{') {
				const pendEnd = findMatchingBrace(content, pos);
				pendingBody = content.slice(pos, pendEnd + 1);
				pos = pendEnd + 1;
			} else if (content[pos] === '(') {
				const pendEnd = findMatchingParen(content, pos);
				pendingBody = content.slice(pos + 1, pendEnd).trim();
				pos = pendEnd + 1;
			} else {
				return null;
			}
		} else if (remaining.startsWith('catch')) {
			pos += 5;
			while (pos < content.length && /\s/.test(content[pos])) pos++;

			// Extract catch parameter
			if (content[pos] === '(') {
				const parenClose = findMatchingParen(content, pos);
				catchParam = content.slice(pos + 1, parenClose).trim();
				pos = parenClose + 1;
			}

			while (pos < content.length && /\s/.test(content[pos])) pos++;
			if (content[pos] === '{') {
				const catchEnd = findMatchingBrace(content, pos);
				catchBody = content.slice(pos, catchEnd + 1);
				pos = catchEnd + 1;
			} else if (content[pos] === '(') {
				const catchEnd = findMatchingParen(content, pos);
				catchBody = content.slice(pos + 1, catchEnd).trim();
				pos = catchEnd + 1;
			} else {
				return null;
			}
		} else {
			break;
		}
	}

	// Transform nested control flow in bodies (only inner content for block bodies)
	const transformedTryBody = tryBody.startsWith('{')
		? `{${transformControlFlowBlocks(tryBody.slice(1, -1))}}`
		: transformControlFlowBlocks(tryBody);
	const transformedCatchBody = catchBody
		? (catchBody.startsWith('{') ? `{${transformControlFlowBlocks(catchBody.slice(1, -1))}}` : transformControlFlowBlocks(catchBody))
		: null;
	const transformedPendingBody = pendingBody
		? (pendingBody.startsWith('{') ? `{${transformControlFlowBlocks(pendingBody.slice(1, -1))}}` : transformControlFlowBlocks(pendingBody))
		: null;

	// Build __try call: tryFn [, catchFn] [, pendingFn]
	let call = `__try(${buildCFCallback(transformedTryBody)}`;

	if (transformedCatchBody !== null) {
		const param = catchParam || 'e';
		call += `, ${buildCFCallback(transformedCatchBody, param)}`;
	} else if (transformedPendingBody !== null) {
		call += ', null';
	}

	if (transformedPendingBody !== null) {
		call += `, ${buildCFCallback(transformedPendingBody)}`;
	}

	call += ')';

	return { text: `{${call}}`, end: outerClose + 1 };
}

// ── Helper: find matching brace ────────────────────────────────────

function findMatchingBrace(code: string, openPos: number): number {
	let depth = 1;
	let i = openPos + 1;
	while (i < code.length && depth > 0) {
		const ch = code[i];
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
		else if (ch === "'" || ch === '"') {
			i = skipString(code, i);
			continue;
		} else if (ch === '`') {
			i = skipTemplateLiteral(code, i);
			continue;
		}
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
		else if (ch === "'" || ch === '"') {
			i = skipString(code, i);
			continue;
		} else if (ch === '`') {
			i = skipTemplateLiteral(code, i);
			continue;
		}
		i++;
	}
	return i - 1;
}
