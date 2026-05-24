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
	// [export] [default] [async] component Name(...) → function Name(...)
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

	// ── 6. Render → return ──
	const renderRe = /(?<![.\w])\brender(?=[\s(<])/g;
	while ((m = renderRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
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
			} else {
				s.overwrite(renderStart, renderEnd, 'return');
			}
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
	}

	// ── 8. Bind shorthand ──
	// bind:{x} → bind:value={x}
	const bindShortRe = /bind:\{(\w+)\}/g;
	while ((m = bindShortRe.exec(source)) !== null) {
		if (inSkipRange(m.index)) continue;
		s.overwrite(m.index, m.index + m[0].length, `bind:value={${m[1]}}`);
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
		}
	}

	// ── 10. Control flow blocks ──
	// Must scan original source for `{if`, `{for`, `{switch`, `{try` in JSX context
	// and overwrite each block with the transformed call expression.
	transformControlFlow(source, s);

	const code = s.toString();
	const map = s.generateMap({ hires: true });

	return { code, map, components, stateVars, derivedVars, renamedParams, styleBlocks };
}

// ── Control flow transformation ────────────────────────────────────

/**
 * Find and transform all JSX control flow blocks using the MagicString instance.
 * Scans the original source for `{if`, `{for`, `{switch`, `{try` blocks and
 * overwrites them with `{__if(...)}`, `{__for(...)}`, etc.
 */
function transformControlFlow(source: string, s: MagicString): void {
	let i = 0;
	while (i < source.length) {
		if (source[i] === "'" || source[i] === '"') { i = skipString(source, i); continue; }
		if (source[i] === '`') { i = skipTemplateLiteral(source, i); continue; }
		if (source[i] === '/' && source[i + 1] === '/') { i = skipLineComment(source, i); continue; }
		if (source[i] === '/' && source[i + 1] === '*') { i = skipBlockComment(source, i); continue; }

		if (source[i] === '{') {
			const result = tryParseCFBlock(source, i);
			if (result) {
				let text = result.text;
				// If the CF block is inside `return (` context (not JSX), strip outer { }
				if (text.startsWith('{') && text.endsWith('}') && isCFInsideReturnParen(source, i)) {
					text = text.slice(1, -1);
				}
				s.overwrite(i, result.end, text);
				i = result.end;
				continue;
			}
		}
		i++;
	}
}

/**
 * Check if a `{` at position `pos` is the sole content inside a `return (...)`.
 * This means the CF call should not be wrapped in `{}` since it's a direct expression.
 */
function isCFInsideReturnParen(source: string, pos: number): boolean {
	// Look backwards: skip whitespace, expect `(`
	let k = pos - 1;
	while (k >= 0 && /\s/.test(source[k])) k--;
	if (k < 0 || source[k] !== '(') return false;
	// Before `(`, skip whitespace, expect `return` (or just-modified to `return`)
	k--;
	while (k >= 0 && /\s/.test(source[k])) k--;
	if (k < 5) return false;
	const word = source.slice(k - 5, k + 1);
	if (word !== 'return' && word !== 'render') return false;
	// Also check that the closing `}` of the CF block aligns with the closing `)` of `return (...)`
	// (i.e., the CF block is the only content inside the parens)
	const closeBrace = findMatchingBrace(source, pos);
	let after = closeBrace + 1;
	while (after < source.length && /\s/.test(source[after])) after++;
	return after < source.length && source[after] === ')';
}

// ── JSX block detection ────────────────────────────────────────────

interface CFResult {
	text: string;
	end: number;
}

/**
 * Attempts to parse a `{...}` block as a JSX control flow expression.
 * Returns null if the block is not a CF block (plain expression, function body, etc.)
 */
function tryParseCFBlock(code: string, openBrace: number): CFResult | null {
	if (!isJSXExpressionContext(code, openBrace)) return null;

	const outerClose = findMatchingBrace(code, openBrace);
	const content = code.slice(openBrace + 1, outerClose).trim();
	if (!content) return null;

	if (/^if\s*\(/.test(content)) return tryParseIfBlock(code, openBrace, outerClose);
	if (/^for\s*\(/.test(content)) return tryParseForBlock(code, openBrace, outerClose);
	if (/^switch\s*\(/.test(content)) return tryParseSwitchBlock(code, openBrace, outerClose);
	if (/^try\s*[({]/.test(content)) return tryParseTryBlock(code, openBrace, outerClose);

	// Block with variable declarations → __block
	if (/^(?:const |let |var )/.test(content)) return tryParseBlock(content, outerClose);

	// {@html expr} → {__html(expr)}
	const htmlMatch = content.match(/^@html\s+/);
	if (htmlMatch) {
		const expr = content.slice(htmlMatch[0].length).trim();
		return { text: `{__html(${expr})}`, end: outerClose + 1 };
	}

	return null;
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

	// Function/arrow/if/for body
	if (pc === ')') return false;
	if (pc === '>' && k > 0 && code[k - 1] === '=') return false;
	if (/\belse$/.test(code.slice(Math.max(0, k - 4), k + 1))) return false;
	if (/\btry$/.test(code.slice(Math.max(0, k - 2), k + 1))) return false;

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

// ── If block ───────────────────────────────────────────────────────

function tryParseIfBlock(code: string, outerBrace: number, outerClose: number): CFResult | null {
	const content = code.slice(outerBrace + 1, outerClose).trim();
	if (!content.startsWith('if')) return null;

	const withReturns = transformRendersInText(content);
	const transformed = transformCFInText(withReturns);

	const output = parseIfChain(transformed);
	if (!output) return null;

	return { text: `{${output}}`, end: outerClose + 1 };
}

function parseIfChain(text: string): string | null {
	let pos = 0;
	if (text.slice(pos, pos + 2) !== 'if') return null;
	pos += 2;
	while (pos < text.length && /\s/.test(text[pos])) pos++;

	if (text[pos] !== '(') return null;
	const condEnd = findMatchingParen(text, pos);
	const condition = text.slice(pos + 1, condEnd);
	pos = condEnd + 1;
	while (pos < text.length && /\s/.test(text[pos])) pos++;

	const trueBranch = extractBody(text, pos);
	if (!trueBranch) return null;
	pos = trueBranch.end;
	while (pos < text.length && /\s/.test(text[pos])) pos++;

	if (pos < text.length && text.slice(pos, pos + 4) === 'else' && !/\w/.test(text[pos + 4] || '')) {
		pos += 4;
		while (pos < text.length && /\s/.test(text[pos])) pos++;

		if (text.slice(pos, pos + 2) === 'if') {
			const nestedCall = parseIfChain(text.slice(pos));
			if (!nestedCall) return null;
			return `__if(() => (${condition}), ${buildCFCallback(trueBranch.body)}, () => ${nestedCall})`;
		}

		const falseBranch = extractBody(text, pos);
		if (!falseBranch) return null;
		return `__if(() => (${condition}), ${buildCFCallback(trueBranch.body)}, ${buildCFCallback(falseBranch.body)})`;
	}

	return `__if(() => (${condition}), ${buildCFCallback(trueBranch.body)})`;
}

// ── For block ──────────────────────────────────────────────────────

function tryParseForBlock(code: string, outerBrace: number, outerClose: number): CFResult | null {
	const content = code.slice(outerBrace + 1, outerClose).trim();
	if (!content.startsWith('for')) return null;

	const parenStart = content.indexOf('(');
	if (parenStart === -1) return null;
	const parenEnd = findMatchingParen(content, parenStart);
	const fullHeader = content.slice(parenStart + 1, parenEnd).trim();

	const bodyText = content.slice(parenEnd + 1).trim();
	let transformedBody: string;
	if (bodyText.startsWith('{') && bodyText.endsWith('}')) {
		const inner = bodyText.slice(1, -1);
		const trimmedInner = inner.trim();
		if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(trimmedInner)) {
			const withReturns = transformRendersInText(trimmedInner);
			const cfExpr = transformDirectCF(withReturns);
			const startIdx = inner.indexOf(trimmedInner);
			transformedBody = `{${inner.slice(0, startIdx)}${cfExpr}${inner.slice(startIdx + trimmedInner.length)}}`;
		} else {
			transformedBody = `{${transformCFInText(transformRendersInText(inner))}}`;
		}
	} else if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(bodyText.trim())) {
		// Bare CF as for-body (no wrapping braces) — transform directly
		const withReturns = transformRendersInText(bodyText);
		transformedBody = transformDirectCF(withReturns);
	} else {
		transformedBody = transformCFInText(transformRendersInText(bodyText));
	}

	// Try parsing as standard for statement
	const forSource = `for (${fullHeader}) {}`;
	const fullResult = oxcParseSync('for-block.tsx', forSource, { sourceType: 'script', lang: 'tsx' });

	if (fullResult.errors.length === 0 && fullResult.program.body.length > 0) {
		const forStmt = fullResult.program.body[0];

		if (forStmt.type === 'ForInStatement') {
			const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
			const objectExpr = forSource.slice(forStmt.right.start, forStmt.right.end);
			const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');
			return { text: `{__for(() => (Object.keys(${objectExpr})), ${buildCFCallback(transformedBody, paramPattern)})}`, end: outerClose + 1 };
		}

		if (forStmt.type === 'ForStatement') {
			const initSrc = forStmt.init ? forSource.slice(forStmt.init.start, forStmt.init.end) : '';
			const testSrc = forStmt.test ? forSource.slice(forStmt.test.start, forStmt.test.end) : '';
			const updateSrc = forStmt.update ? forSource.slice(forStmt.update.start, forStmt.update.end) : '';
			let loopVar = '__i';
			if (forStmt.init && forStmt.init.type === 'VariableDeclaration') {
				const firstDecl = forStmt.init.declarations[0];
				if (firstDecl && firstDecl.id.type === 'Identifier') loopVar = firstDecl.id.name;
			} else if (forStmt.init && forStmt.init.type === 'AssignmentExpression' && forStmt.init.left.type === 'Identifier') {
				loopVar = forStmt.init.left.name;
			}
			const collectionFn = `{ const __a = []; for (${initSrc}; ${testSrc}; ${updateSrc}) __a.push(${loopVar}); return __a; }`;
			return { text: `{__for(() => ${collectionFn}, ${buildCFCallback(transformedBody, loopVar)})}`, end: outerClose + 1 };
		}

		if (forStmt.type === 'ForOfStatement') {
			const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
			const collection = forSource.slice(forStmt.right.start, forStmt.right.end);
			const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');
			return { text: `{__for(() => (${collection}), ${buildCFCallback(transformedBody, paramPattern)})}`, end: outerClose + 1 };
		}
	}

	// DarTsx extensions: for (const item of items; key expr; index i)
	const parts = fullHeader.split(';').map((p) => p.trim());
	const mainPart = parts[0];
	let indexName: string | null = null;
	let keyExpr: string | null = null;
	for (let k = 1; k < parts.length; k++) {
		const part = parts[k];
		if (part.startsWith('index ')) indexName = part.slice(6).trim();
		else if (part.startsWith('key ')) keyExpr = part.slice(4).trim();
	}

	const forOfSource = `for (${mainPart}) {}`;
	const forOfResult = oxcParseSync('for-block.tsx', forOfSource, { sourceType: 'script', lang: 'tsx' });
	if (forOfResult.errors.length > 0 || forOfResult.program.body.length === 0) return null;

	const forOfStmt = forOfResult.program.body[0];
	if (forOfStmt.type !== 'ForOfStatement') return null;

	const leftSource = forOfSource.slice(forOfStmt.left.start, forOfStmt.left.end);
	const collection = forOfSource.slice(forOfStmt.right.start, forOfStmt.right.end);
	const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');

	const params = indexName ? `${paramPattern}, ${indexName}` : paramPattern;
	const callback = buildCFCallback(transformedBody, params);
	let text: string;
	if (keyExpr) {
		const lineStart = code.lastIndexOf('\n', outerBrace);
		const outerIndent = lineStart >= 0 ? (code.slice(lineStart + 1, outerBrace).match(/^(\s*)/) || ['', ''])[1] : '';
		const bodyIndent = outerIndent + '  ';
		text = `{__for(() => (${collection}), ${callback},\n${bodyIndent}(${paramPattern}) => (${keyExpr})\n${outerIndent})}`;
	} else {
		text = `{__for(() => (${collection}), ${callback})}`;
	}

	return { text, end: outerClose + 1 };
}

// ── Switch block ───────────────────────────────────────────────────

function tryParseSwitchBlock(code: string, outerBrace: number, outerClose: number): CFResult | null {
	const content = code.slice(outerBrace + 1, outerClose).trim();
	if (!content.startsWith('switch')) return null;

	const outerLineStart = code.lastIndexOf('\n', outerBrace);
	const closeIndent = outerLineStart >= 0 ? (code.slice(outerLineStart + 1, outerBrace).match(/^(\s*)/) || ['', ''])[1] : '';

	const transformed = transformCFInText(transformRendersInText(content));

	let src = transformed;
	let result = oxcParseSync('switch-block.tsx', src, { sourceType: 'script', lang: 'tsx' });
	if (result.errors.length > 0) {
		src = `function __(){${transformed}}`;
		result = oxcParseSync('switch-block.tsx', src, { sourceType: 'script', lang: 'tsx' });
		if (result.errors.length > 0) return null;
		const fnDecl = result.program.body[0];
		if (!fnDecl || fnDecl.type !== 'FunctionDeclaration' || !fnDecl.body) return null;
		const firstStmt = fnDecl.body.body[0];
		if (!firstStmt || firstStmt.type !== 'SwitchStatement') return null;
		const discriminant = src.slice(firstStmt.discriminant.start, firstStmt.discriminant.end);
		return buildSwitchOutput(src, firstStmt, discriminant, outerClose, closeIndent);
	}

	const firstStmt = result.program.body[0];
	if (!firstStmt || firstStmt.type !== 'SwitchStatement') return null;
	const discriminant = src.slice(firstStmt.discriminant.start, firstStmt.discriminant.end);
	return buildSwitchOutput(src, firstStmt, discriminant, outerClose, closeIndent);
}

function buildSwitchOutput(source: string, switchStmt: SwitchStatement, discriminant: string, outerClose: number, closeIndent: string): CFResult {
	const switchCases = switchStmt.cases || [];

	const groups: { values: string[]; isDefault: boolean; body: string; bodyPrefix: string }[] = [];
	let pendingValues: string[] = [];
	let pendingDefault = false;

	for (let ci = 0; ci < switchCases.length; ci++) {
		const sc = switchCases[ci];
		if (sc.test) pendingValues.push(source.slice(sc.test.start, sc.test.end));
		else pendingDefault = true;

		const consequent = sc.consequent || [];
		const bodyStmts = consequent.filter((st) => st.type !== 'BreakStatement' && st.type !== 'ReturnStatement');
		const hasBreak = consequent.some((st) => st.type === 'BreakStatement');
		const hasReturn = consequent.some((st) => st.type === 'ReturnStatement');
		const isLast = ci === switchCases.length - 1;

		if (bodyStmts.length > 0 || hasBreak || hasReturn || isLast) {
			let body = '';
			let bodyPrefix = '';
			const allBodyStmts = hasReturn ? consequent.filter((st) => st.type !== 'BreakStatement') : bodyStmts;
			if (allBodyStmts.length > 0) {
				const start = allBodyStmts[0].start;
				const end = allBodyStmts[allBodyStmts.length - 1].end;
				body = source.slice(start, end);
				const caseEnd = sc.test ? sc.test.end : sc.start + 7;
				const between = source.slice(caseEnd, start);
				const nlIdx = between.indexOf('\n');
				if (nlIdx >= 0) bodyPrefix = between.slice(nlIdx);
			}

			groups.push({ values: [...pendingValues], isDefault: pendingDefault, body: body.trim(), bodyPrefix });
			pendingValues = [];
			pendingDefault = false;
		}
	}

	let caseIndent = '  ';
	if (switchCases.length > 0) {
		const firstStart = switchCases[0].start;
		const lineStart = source.lastIndexOf('\n', firstStart);
		if (lineStart >= 0) {
			const linePrefix = source.slice(lineStart + 1, firstStart);
			const indent = linePrefix.match(/^(\s*)/);
			if (indent) caseIndent = indent[1];
		}
	}
	const bodyIndent = caseIndent + '  ';

	const discArg = `() => (${discriminant})`;
	const cases: string[] = [];
	for (const g of groups) {
		const valuesStr = g.isDefault ? 'null' : `[${g.values.join(', ')}]`;
		let body = g.body;
		if (/\breturn\b/.test(body)) {
			const lines = body.split('\n').map(l => l.trimStart());
			body = `{\n${bodyIndent}${lines.join('\n' + bodyIndent)}\n${caseIndent}}`;
			cases.push(`${valuesStr}, ${buildCFCallback(body)}`);
		} else if (g.bodyPrefix && body.startsWith('<')) {
			cases.push(`${valuesStr}, () =>${g.bodyPrefix}${body}`);
		} else {
			cases.push(`${valuesStr}, ${buildCFCallback(body)}`);
		}
	}

	const output = `__switch(${discArg},\n${caseIndent}${cases.join(',\n' + caseIndent)}\n${closeIndent})`;
	return { text: `{${output}}`, end: outerClose + 1 };
}

// ── Try block ──────────────────────────────────────────────────────

function tryParseTryBlock(code: string, outerBrace: number, outerClose: number): CFResult | null {
	const content = code.slice(outerBrace + 1, outerClose).trim();
	if (!content.startsWith('try')) return null;

	let pos = 3;
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
			} else return null;
		} else if (remaining.startsWith('catch')) {
			pos += 5;
			while (pos < content.length && /\s/.test(content[pos])) pos++;
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
			} else return null;
		} else break;
	}

	const xformBody = (b: string) => {
		return b.startsWith('{')
			? `{${transformCFInText(transformRendersInText(b.slice(1, -1)))}}`
			: transformCFInText(transformRendersInText(b));
	};

	const transformedTryBody = xformBody(tryBody);
	const transformedCatchBody = catchBody ? xformBody(catchBody) : null;
	const transformedPendingBody = pendingBody ? xformBody(pendingBody) : null;

	let call = `__try(${buildCFCallback(transformedTryBody)}`;
	if (transformedCatchBody !== null) {
		call += `, ${buildCFCallback(transformedCatchBody, catchParam || 'e')}`;
	} else if (transformedPendingBody !== null) {
		call += ', null';
	}
	if (transformedPendingBody !== null) {
		call += `, ${buildCFCallback(transformedPendingBody)}`;
	}
	call += ')';

	return { text: `{${call}}`, end: outerClose + 1 };
}

// ── Block scope ────────────────────────────────────────────────────

function tryParseBlock(content: string, outerClose: number): CFResult | null {
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
		if (wb && /^(?:if\s*\(|for\s*\(|switch\s*\(|try\s*[({]|(?:return|render)[\s(<])/.test(tail)) { bodyIdx = i; break; }
		i++;
	}
	if (bodyIdx === -1) return null;

	let preamble = content.slice(0, bodyIdx).trim();
	const body = content.slice(bodyIdx).trim();
	if (!preamble) return null;
	if (!preamble.endsWith(';')) preamble += ';';

	let finalBody: string;
	if (body.startsWith('return') || body.startsWith('render')) {
		// Replace 'render' with 'return' since we're operating on original source
		finalBody = body.startsWith('render') ? 'return' + body.slice(6) : body;
	} else if (/^(?:if|for|switch|try)\b/.test(body)) {
		const cfExpr = transformDirectCF(body);
		finalBody = `return (<>{${cfExpr}}</>)`;
	} else {
		return null;
	}

	return { text: `{__block(() => { ${preamble} ${finalBody} })}`, end: outerClose + 1 };
}

// ── Callback builder ───────────────────────────────────────────────

function buildCFCallback(body: string, params?: string): string {
	const arrow = params ? `(${params}) =>` : `() =>`;
	const trimmed = body.trim();

	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		const inner = trimmed.slice(1, -1).trim();
		if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(inner)) {
			const cfExpr = transformDirectCF(inner);
			return `${arrow} (${cfExpr})`;
		}
		return `${arrow} ${body}`;
	}

	if (/^(?:if\s*\(|for\s*[\s(]|switch\s*\(|try\s*[({])/.test(trimmed)) {
		const cfExpr = transformDirectCF(body);
		return `${arrow} ${cfExpr}`;
	}

	if (trimmed.startsWith('<')) {
		if (isSingleJSXRoot(body)) return `${arrow} ${body.trim()}`;
		return `${arrow} (<>${body}</>)`;
	}

	if (trimmed.startsWith('(') && trimmed.endsWith(')')) return `${arrow} ${trimmed}`;

	return `${arrow} (${body})`;
}

// ── Text-level render transform (for CF body text) ─────────────────

function transformRendersInText(code: string): string {
	let result = '';
	let i = 0;

	while (i < code.length) {
		if (code[i] === '/' && code[i + 1] === '/') { const end = skipLineComment(code, i); result += code.slice(i, end); i = end; continue; }
		if (code[i] === '/' && code[i + 1] === '*') { const end = skipBlockComment(code, i); result += code.slice(i, end); i = end; continue; }
		if (code[i] === "'" || code[i] === '"') { const end = skipString(code, i); result += code.slice(i, end); i = end; continue; }
		if (code[i] === '`') { const end = skipTemplateLiteral(code, i); result += code.slice(i, end); i = end; continue; }

		if (
			code.slice(i, i + 6) === 'render' &&
			(i === 0 || (!/\w/.test(code[i - 1]) && code[i - 1] !== '.')) &&
			/[\s(<]/.test(code[i + 6] || '')
		) {
			let j = i + 6;
			while (j < code.length && /[ \t]/.test(code[j])) j++;

			if (code[j] === '(') {
				const closePos = findMatchingParen(code, j);
				const content = code.slice(j + 1, closePos);
				const inner = transformRendersInText(content);
				if (isSingleJSXRoot(inner)) {
					result += `return (${inner})`;
				} else {
					result += `return (<>${inner}</>)`;
				}
				i = closePos + 1;
				continue;
			} else if (code[j] === '<') {
				const jsxEnd = findJSXElementEnd(code, j);
				if (jsxEnd > j) {
					result += `return ${transformRendersInText(code.slice(j, jsxEnd))}`;
					i = jsxEnd;
					continue;
				}
			} else if (code[j] && code[j] !== '{') {
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

// ── Direct CF transform (for known-CF text without JSX context) ────

/**
 * Transforms a CF expression directly, bypassing JSX context detection.
 * Use when the text is known to be a CF block (if/for/switch/try).
 */
function transformDirectCF(text: string): string {
	const trimmed = text.trim();
	if (/^if\s*\(/.test(trimmed)) {
		const result = parseIfChain(transformCFInText(trimmed));
		return result || text;
	}
	// Wrap in synthetic context so transformCFInText can find it
	const wrapped = `>\n{${trimmed}}`;
	const transformed = transformCFInText(wrapped);
	// Strip the synthetic prefix
	const braceStart = transformed.indexOf('{');
	if (braceStart >= 0 && transformed.endsWith('}')) {
		return transformed.slice(braceStart + 1, -1);
	}
	return text;
}

// ── Text-level CF transform (for nested CF in bodies) ──────────────

function transformCFInText(code: string): string {
	let result = '';
	let i = 0;

	while (i < code.length) {
		if (code[i] === "'" || code[i] === '"') { const end = skipString(code, i); result += code.slice(i, end); i = end; continue; }
		if (code[i] === '`') { const end = skipTemplateLiteral(code, i); result += code.slice(i, end); i = end; continue; }

		if (code[i] === '{') {
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

			const parsed = tryParseCFBlockInText(code, i);
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

function tryParseCFBlockInText(code: string, openBrace: number): CFResult | null {
	if (!isJSXExpressionContext(code, openBrace)) return null;

	const outerClose = findMatchingBrace(code, openBrace);
	const content = code.slice(openBrace + 1, outerClose).trim();
	if (!content) return null;

	if (/^if\s*\(/.test(content)) return tryParseIfBlock(code, openBrace, outerClose);
	if (/^for\s*\(/.test(content)) return tryParseForBlock(code, openBrace, outerClose);
	if (/^switch\s*\(/.test(content)) return tryParseSwitchBlock(code, openBrace, outerClose);
	if (/^try\s*[({]/.test(content)) return tryParseTryBlock(code, openBrace, outerClose);
	if (/^(?:const |let |var )/.test(content)) return tryParseBlock(content, outerClose);

	return null;
}

// ── Extract body helper ────────────────────────────────────────────

function extractBody(text: string, pos: number): { body: string; end: number } | null {
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
		if (trimmed.startsWith('<') && !isSingleJSXRoot(trimmed)) {
			return { body: `(<>${raw}</>)`, end: close + 1 };
		}
		return { body: `(${raw})`, end: close + 1 };
	}

	if (ch === '<') {
		const end = findJSXElementEnd(text, pos);
		return { body: text.slice(pos, end), end };
	}

	const end = findExpressionEnd(text, pos);
	return { body: text.slice(pos, end), end };
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

// ── Parse with OXC ─────────────────────────────────────────────────

export function parse(filename: string, code: string, lang: 'tsx' | 'jsx' = 'tsx') {
	return oxcParseSync(filename, code, { sourceType: 'module', lang });
}
