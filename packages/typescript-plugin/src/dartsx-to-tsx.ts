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
		|| /\bstate\s+\w+\s*=/.test(sample)
		|| /\bderived\s+\w+\s*=/.test(sample)
		|| /\brender\s*\(/.test(sample)
		|| /<[^>]*\bbind:(?:\{[a-zA-Z_]\w*\}|[a-zA-Z][\w-]*)\b/.test(sample);
}

/**
 * Transform DarTsx source into valid TSX.
 */
export function dartsxToTsx(source: string): TransformResult {
	const ms = new MagicString(source);

	transformComponentDeclarations(ms, source);
	transformRenamedParams(ms, source);
	transformBindInParams(ms, source);
	transformStateDeclarations(ms, source);
	transformDerivedDeclarations(ms, source);
	transformRenderBlocks(ms, source);
	transformBindShorthand(ms, source);
	transformBindAttributes(ms, source);

	return { code: ms.toString(), ms };
}

// ── component → function ───────────────────────────────────────────

function transformComponentDeclarations(ms: MagicString, source: string): void {
	const re = /\b((?:export\s+)?(?:default\s+)?(?:async\s+)?)component(\s+\w+)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
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

function transformStateDeclarations(ms: MagicString, source: string): void {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate(\s+\w+\s*)(?==)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const stateStart = match.index + (match[1]?.length ?? 0);
		const stateEnd = stateStart + 'state'.length;
		ms.overwrite(stateStart, stateEnd, 'let');
	}
}

// ── derived x = → const x = ───────────────────────────────────────

function transformDerivedDeclarations(ms: MagicString, source: string): void {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(\s+\w+\s*)(?==)/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const derivedStart = match.index + (match[1]?.length ?? 0);
		const derivedEnd = derivedStart + 'derived'.length;
		ms.overwrite(derivedStart, derivedEnd, 'const');
	}
}

// ── render (...) → return (<>...</>) ───────────────────────────────

function transformRenderBlocks(ms: MagicString, source: string): void {
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
