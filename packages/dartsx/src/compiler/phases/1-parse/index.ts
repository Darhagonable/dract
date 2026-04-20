/**
 * Phase 1 — Parse
 *
 * Pre-processes DarTsx custom syntax into valid TSX that OXC can parse,
 * then parses with OXC. Returns the AST plus metadata about which
 * identifiers are state/derived/components.
 */
import { parseSync } from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

export interface ComponentMeta {
	name: string;
	isExport: boolean;
	isDefault: boolean;
	isAsync: boolean;
}

/** Marker comments embedded in preprocessed code to identify state/derived declarations */
export const STATE_MARKER = '/*@s*/';
export const DERIVED_MARKER = '/*@d*/';

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
	/** Source offset where the style block was found (for component association) */
	sourceOffset: number;
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
 * Transform `state varName: Type = expr` → `let varName MARKER = expr`
 * Properly handles balanced braces inside type annotations.
 */
function transformStateDeclarations(code: string, stateVars: string[], marker: string): string {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bstate\s+(\w+)/g;
	let result = '';
	let lastIndex = 0;
	let match;

	while ((match = re.exec(code)) !== null) {
		const exportKw = match[1] || '';
		const name = match[2];
		const matchEnd = match.index + match[0].length;

		// Skip the type annotation if present
		const afterType = skipTypeAnnotation(code, matchEnd);

		stateVars.push(name);
		result += code.slice(lastIndex, match.index);
		result += `${exportKw}let ${name} ${marker} `;
		lastIndex = afterType;
	}

	result += code.slice(lastIndex);
	return result;
}

/**
 * Transform `derived varName: Type = expr` → `const varName MARKER = expr`
 * Properly handles balanced braces inside type annotations.
 */
function transformDerivedDeclarations(code: string, derivedVars: string[], marker: string): string {
	const re = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived\s+(\w+)/g;
	let result = '';
	let lastIndex = 0;
	let match;

	while ((match = re.exec(code)) !== null) {
		const exportKw = match[1] || '';
		const name = match[2];
		const matchEnd = match.index + match[0].length;

		// Skip the type annotation if present
		const afterType = skipTypeAnnotation(code, matchEnd);

		derivedVars.push(name);
		result += code.slice(lastIndex, match.index);
		result += `${exportKw}const ${name} ${marker} `;
		lastIndex = afterType;
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

	// 0. Neutralize comments so keyword regexes don't match inside them.
	//    Replace comment content with spaces (preserving newlines for line counts).
	//    This prevents e.g. `state variable` inside a JSDoc comment from being
	//    transformed into `let variable /*@s*/`.
	//    The regex skips string literals to avoid false matches on `//` or `/*` in strings.
	code = code.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, (match, str, comment) => {
		if (str) return str; // preserve strings
		return comment.replace(/[^\n]/g, ' '); // blank out comment content
	});

	// 1. Transform component declarations
	//    Handles: [export] [default] [async] component Name(...)
	code = code.replace(
		/\b(export\s+)?(default\s+)?(async\s+)?component\s+(\w+)/g,
		(_match, exportKw, defaultKw, asyncKw, name) => {
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

	// 2. Transform `state varName = expr`, `state varName: Type = expr`, or `state varName: Type` → `let varName /*@s*/ ...`
	//    The /*@s*/ marker lets the analyzer identify this as a state declaration
	//    regardless of scope, without relying on name matching alone.
	//    Optional type annotations (`: Type`) are stripped — the runtime $.state()
	//    call infers the type from the initializer.
	//    Uses a function-based replacement to properly handle balanced braces
	//    inside type annotations (e.g. `{ id: string; text: string }`).
	code = transformStateDeclarations(code, stateVars, STATE_MARKER);

	// 3a. Transform destructured derived declarations into a temp plus
	//     one derived binding per leaf identifier. This supports nested
	//     object/array patterns, aliases, defaults, and rest bindings.
	code = transformDerivedDestructuring(code, derivedVars);

	// 3b. Transform `derived varName = expr` or `derived varName: Type = expr` → `const varName /*@d*/ = expr`
	//    Uses the same balanced-brace-aware stripping as state.
	code = transformDerivedDeclarations(code, derivedVars, DERIVED_MARKER);

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

		blocks.push({
			css,
			isGlobal,
			sourceOffset: openTagStart,
		});

		// Replace the entire <style>...</style> with whitespace to preserve offsets
		result += code.slice(lastIndex, openTagStart);
		// Use spaces to avoid shifting offsets for subsequent matches
		result += ' '.repeat(fullEnd - openTagStart);
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
				// render (...) → return (<>...</>)
				const closePos = findMatchingParen(code, j);
				const content = code.slice(j + 1, closePos);
				result += `return (<>${transformRenders(content)}</>)`;
				i = closePos + 1;
				continue;
			} else if (code[j] === '<') {
				// render <jsx> → return (<>jsx</>)
				const jsxEnd = findJSXElementEnd(code, j);
				if (jsxEnd > j) {
					const jsx = code.slice(j, jsxEnd);
					result += `return (<>${transformRenders(jsx)}</>)`;
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

export function parse(filename: string, code: string) {
	return parseSync(filename, code, { sourceType: 'module', lang: 'tsx' });
}

function transformDerivedDestructuring(code: string, derivedVars: string[]): string {
	const derivedRegex = /(\bexport\s+)?(?<!\.)(?<!\w)\bderived(?=\s+[{[])/g;
	let match: RegExpExecArray | null;
	let result = '';
	let lastIndex = 0;
	let counter = 0;

	while ((match = derivedRegex.exec(code)) !== null) {
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

		const exprStart = skipWhitespace(code, cursor + 1);
		const exprEnd = findStatementEnd(code, exprStart);
		const pattern = code.slice(patternStart, patternEnd + 1);
		const expr = code.slice(exprStart, exprEnd).trim();

		result += code.slice(lastIndex, start);
		result += lowerDerivedPattern(pattern, expr, exportKw, derivedVars, counter++);

		let nextIndex = exprEnd;
		if (code[nextIndex] === ';') nextIndex++;
		lastIndex = nextIndex;
		derivedRegex.lastIndex = nextIndex;
	}

	result += code.slice(lastIndex);
	return result;
}

function lowerDerivedPattern(
	pattern: string,
	expr: string,
	exportKw: string,
	derivedVars: string[],
	counter: number,
): string {
	const tempName = `__derived_${counter}`;
	const bindings = collectDerivedBindings(pattern, tempName);
	const lines = [`const ${tempName} = ${expr}`];

	for (const binding of bindings) {
		derivedVars.push(binding.name);
		lines.push(`${exportKw}const ${binding.name} ${DERIVED_MARKER} = ${binding.expr}`);
	}

	return lines.join(';\n\t');
}

function collectDerivedBindings(pattern: string, baseExpr: string): Array<{ name: string; expr: string }> {
	const source = `const ${pattern} = __source__`;
	const parsed = parseSync('derived-pattern.ts', source, { sourceType: 'module', lang: 'tsx' });
	const stmt = parsed.program.body[0] as any;
	const decl = stmt?.declarations?.[0];
	const bindings: Array<{ name: string; expr: string }> = [];
	collectDerivedBindingsFromNode(decl?.id, baseExpr, source, bindings);
	return bindings;
}

function collectDerivedBindingsFromNode(
	node: any,
	baseExpr: string,
	source: string,
	bindings: Array<{ name: string; expr: string }>,
): void {
	if (!node) return;

	if (node.type === 'Identifier') {
		bindings.push({ name: node.name, expr: baseExpr });
		return;
	}

	if (node.type === 'AssignmentPattern') {
		const defaultExpr = source.slice(node.right.start, node.right.end);
		const withDefault = `(() => { const __value = ${baseExpr}; return __value === undefined ? ${defaultExpr} : __value; })()`;
		collectDerivedBindingsFromNode(node.left, withDefault, source, bindings);
		return;
	}

	if (node.type === 'RestElement') {
		collectRestBindings(node.argument, node, baseExpr, source, bindings);
		return;
	}

	if (node.type === 'ObjectPattern') {
		const excludedKeys = collectObjectRestKeys(node.properties || [], source);
		for (const prop of node.properties || []) {
			if (prop?.type === 'RestElement') {
				collectRestBindings(prop.argument, prop, baseExpr, source, bindings, excludedKeys);
				continue;
			}
			const nextBase = `${baseExpr}${buildObjectPropertyAccess(prop, source)}`;
			collectDerivedBindingsFromNode(prop?.value, nextBase, source, bindings);
		}
		return;
	}

	if (node.type === 'ArrayPattern') {
		for (let index = 0; index < (node.elements || []).length; index++) {
			const element = node.elements[index];
			if (!element) continue;
			if (element.type === 'RestElement' && element.argument?.type === 'Identifier') {
				bindings.push({ name: element.argument.name, expr: `${baseExpr}.slice(${index})` });
				continue;
			}
			const nextBase = `${baseExpr}[${index}]`;
			collectDerivedBindingsFromNode(element, nextBase, source, bindings);
		}
	}
}

function collectRestBindings(
	argument: any,
	node: any,
	baseExpr: string,
	source: string,
	bindings: Array<{ name: string; expr: string }>,
	excludedKeys: string[] = [],
): void {
	if (argument?.type === 'Identifier') {
		if (node?.type === 'RestElement' && excludedKeys.length > 0) {
			const deletes = excludedKeys.map((key) => `delete __rest[${key}];`).join(' ');
			bindings.push({
				name: argument.name,
				expr: `(() => { const __rest = { ...(${baseExpr} ?? {}) }; ${deletes} return __rest; })()`,
			});
			return;
		}
		bindings.push({ name: argument.name, expr: baseExpr });
		return;
	}

	collectDerivedBindingsFromNode(argument, baseExpr, source, bindings);
}

function buildObjectPropertyAccess(prop: any, source: string): string {
	if (prop.computed) {
		return `[${source.slice(prop.key.start, prop.key.end)}]`;
	}

	if (prop.key?.type === 'Identifier') {
		return `.${prop.key.name}`;
	}

	return `[${source.slice(prop.key.start, prop.key.end)}]`;
}

function collectObjectRestKeys(properties: any[], source: string): string[] {
	const keys: string[] = [];
	for (const prop of properties) {
		if (!prop || prop.type === 'RestElement') continue;
		if (prop.computed) {
			keys.push(source.slice(prop.key.start, prop.key.end));
			continue;
		}
		if (prop.key?.type === 'Identifier') {
			keys.push(JSON.stringify(prop.key.name));
			continue;
		}
		keys.push(source.slice(prop.key.start, prop.key.end));
	}
	return keys;
}


function skipWhitespace(code: string, index: number): number {
	let i = index;
	while (i < code.length && /\s/.test(code[i])) i++;
	return i;
}

function findStatementEnd(code: string, start: number): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let i = start;

	while (i < code.length) {
		const ch = code[i];
		if (ch === '\'' || ch === '"') {
			i = skipString(code, i);
			continue;
		}
		if (ch === '`') {
			i = skipTemplateLiteral(code, i);
			continue;
		}
		if (ch === '/' && code[i + 1] === '/') {
			i = skipLineComment(code, i);
			continue;
		}
		if (ch === '/' && code[i + 1] === '*') {
			i = skipBlockComment(code, i);
			continue;
		}
		if (ch === '(') parenDepth++;
		else if (ch === ')') parenDepth--;
		else if (ch === '[') bracketDepth++;
		else if (ch === ']') bracketDepth--;
		else if (ch === '{') braceDepth++;
		else if (ch === '}') {
			if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return i;
			braceDepth--;
		}
		else if (ch === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return i;
		else if (ch === '\n' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return i;
		i++;
	}

	return i;
}

// ── Control flow block transformation ──────────────────────────────

/**
 * Wraps a control flow block body as an arrow function callback.
 * Detects block-render patterns (statements + `return (...)` from
 * step-4 preprocessing) and produces a block-body arrow; otherwise
 * produces an inline arrow: `(params) => (<>body</>)`.
 */
function buildCFCallback(body: string, params?: string): string {
	const arrow = params ? `(${params}) =>` : `() =>`;

	// JSX body: starts with `<` (element/fragment)
	// → wrap in fragment so OXC parses as JSX children.
	// Check this FIRST: even if the body contains nested callbacks with `return`,
	// a body that starts with `<` is JSX and needs fragment wrapping.
	const trimmed = body.trim();
	if (trimmed.startsWith('<')) {
		return `${arrow} (<>${body}</>)`;
	}

	// Transformed render block: body contains `return (...)` from step-4/4b preprocessing.
	// This matches multi-statement bodies like `const x = ...; return (<>...</>)`.
	// Only match `return` at the top level (not inside nested `{ }` braces) to avoid
	// false matches on nested CF callbacks.
	if (containsTopLevelReturn(body)) {
		return `${arrow} { ${body} }`;
	}

	// Bare JS expression (count, "text", 6, {name: "John"}.name, etc.)
	// → return directly without wrapping in JSX fragment
	return `${arrow} (${body})`;
}

/** Check if body contains a `return` keyword at the top brace level (not inside nested { }) */
function containsTopLevelReturn(body: string): boolean {
	let depth = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
		else if (ch === "'" || ch === '"') {
			const q = ch;
			i++;
			while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; }
		} else if (ch === '`') {
			i++;
			while (i < body.length && body[i] !== '`') { if (body[i] === '\\') i++; i++; }
		} else if (depth === 0 && ch === 'r') {
			const slice = body.slice(i, i + 7);
			if (/^return[\s(]/.test(slice) && (i === 0 || !/\w/.test(body[i - 1]))) {
				return true;
			}
		}
	}
	return false;
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
		if (/[\w\]>]/.test(pc)) {
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
	if (/^try\s*\{/.test(rest)) return tryParseTryBlock(code, openBrace);

	// ── Case 2: Block scope (starts with variable declaration) ──
	if (/^(?:const |let |var )/.test(rest)) {
		return tryParseBlock(content, outerClose);
	}

	// ── Case 3: Single expression → pass through to OXC ──
	return null;
}

/**
 * Parses a block scope `{ stmts; body }` where body is render/CF/bare-JSX.
 *
 * By the time we get here, `render <jsx>` has already become `return (<>jsx</>)`
 * from step 4b. We split the content into preamble statements and a trailing
 * body (CF keyword, return, or bare JSX), then emit `__block(() => { ... })`.
 */
function tryParseBlock(content: string, outerClose: number): ControlFlowResult | null {
	// Scan for where the body starts: the first top-level CF keyword,
	// `return` (from render), or `<` (bare JSX).
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
		if (wb && /^(?:if\s*\(|for\s*\(|switch\s*\(|try\s*\{|return[\s(])/.test(tail)) { bodyIdx = i; break; }
		if (ch === '<' && /[A-Za-z]/.test(content[i + 1] || '') && content[i + 1] !== '=' && content[i + 1] !== '<') { bodyIdx = i; break; }
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
	} else if (body.startsWith('<')) {
		// Bare JSX — wrap as return
		finalBody = `return (<>${body}</>)`;
	} else {
		return null;
	}

	return { text: `{__block(() => { ${preamble} ${finalBody} })}`, end: outerClose + 1 };
}

function tryParseIfBlock(code: string, outerBrace: number): ControlFlowResult | null {
	// Find the matching brace of the JSX expression container {if (...) {...}}
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('if')) return null;

	// Recursively transform nested control flow blocks first,
	// so the content becomes valid TSX that OXC can parse.
	const transformed = transformControlFlowBlocks(content);

	// Parse the transformed if statement with OXC.
	// If bodies contain `return` (from block-render), wrap in a function
	// so the return is valid.
	let source = transformed;
	let result = parseSync('if-block.tsx', source, {
		sourceType: 'script',
		lang: 'tsx',
	});
	if (result.errors.length > 0) {
		source = `function __(){${transformed}}`;
		result = parseSync('if-block.tsx', source, { sourceType: 'script', lang: 'tsx' });
		if (result.errors.length > 0) return null;
		const fnBody = (result.program.body[0] as any)?.body?.body;
		if (!fnBody?.length || fnBody[0].type !== 'IfStatement') return null;
		const output = buildIfCall(source, fnBody[0]);
		return { text: `{${output}}`, end: outerClose + 1 };
	}

	const stmts = result.program.body;
	if (stmts.length === 0 || stmts[0].type !== 'IfStatement') return null;

	const output = buildIfCall(source, stmts[0]);
	return { text: `{${output}}`, end: outerClose + 1 };
}

/**
 * Recursively build __if() calls from an OXC IfStatement AST node.
 * Handles else-if chains naturally through AST recursion.
 */
function buildIfCall(source: string, stmt: any): string {
	const condition = source.slice(stmt.test.start, stmt.test.end);
	const trueBody = extractBranchBody(source, stmt.consequent);

	if (stmt.alternate) {
		if (stmt.alternate.type === 'IfStatement') {
			// else if — recurse to build nested __if, wrapped in expression container
			const nestedCall = buildIfCall(source, stmt.alternate);
			return `__if(() => (${condition}), ${buildCFCallback(trueBody)}, () => (<>{${nestedCall}}</>))`;
		}
		// else block
		const falseBody = extractBranchBody(source, stmt.alternate);
		return `__if(() => (${condition}), ${buildCFCallback(trueBody)}, ${buildCFCallback(falseBody)})`;
	}

	return `__if(() => (${condition}), ${buildCFCallback(trueBody)})`;
}

/** Extract body text from a branch node — strips braces for BlockStatement, uses full text otherwise */
function extractBranchBody(source: string, node: any): string {
	if (node.type === 'BlockStatement') {
		return source.slice(node.start + 1, node.end - 1).trim();
	}
	return source.slice(node.start, node.end).trim();
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

	// Extract body (everything after the header parens)
	const bodyText = content.slice(parenEnd + 1).trim();
	let body: string;
	if (bodyText.startsWith('{') && bodyText.endsWith('}')) {
		body = bodyText.slice(1, -1).trim();
	} else {
		body = bodyText;
	}

	// Recursively transform nested control flow
	const transformedBody = transformControlFlowBlocks(body);

	// Try parsing the full header to determine loop type
	const forSource = `for (${fullHeader}) {}`;
	const fullResult = parseSync('for-block.tsx', forSource, {
		sourceType: 'script',
		lang: 'tsx',
	});

	if (fullResult.errors.length === 0 && fullResult.program.body.length > 0) {
		const forStmt = fullResult.program.body[0] as any;

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
			if (forStmt.init?.type === 'VariableDeclaration' && forStmt.init.declarations?.[0]?.id?.name) {
				loopVar = forStmt.init.declarations[0].id.name;
			} else if (forStmt.init?.type === 'AssignmentExpression' && forStmt.init.left?.name) {
				loopVar = forStmt.init.left.name;
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
	const forOfResult = parseSync('for-block.tsx', forOfSource, {
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
	if (keyExpr) {
		text = `{__for(() => (${collection}), ${buildCFCallback(transformedBody, params)}, (${paramPattern}) => (${keyExpr}))}`;
	} else {
		text = `{__for(() => (${collection}), ${buildCFCallback(transformedBody, params)})}`;
	}

	return { text, end: outerClose + 1 };
}

function tryParseSwitchBlock(code: string, outerBrace: number): ControlFlowResult | null {
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('switch')) return null;

	// Recursively transform nested control flow blocks first
	const transformed = transformControlFlowBlocks(content);

	// Parse the transformed switch statement with OXC.
	// If cases contain `return` (from block-render), wrap in a function.
	let source = transformed;
	let result = parseSync('switch-block.tsx', source, {
		sourceType: 'script',
		lang: 'tsx',
	});
	if (result.errors.length > 0) {
		source = `function __(){${transformed}}`;
		result = parseSync('switch-block.tsx', source, { sourceType: 'script', lang: 'tsx' });
		if (result.errors.length > 0) return null;
		const fnBody = (result.program.body[0] as any)?.body?.body;
		if (!fnBody?.length || fnBody[0].type !== 'SwitchStatement') return null;
		// Continue with the switch statement from the function body
		const switchStmt = fnBody[0];
		const discriminant = source.slice(switchStmt.discriminant.start, switchStmt.discriminant.end);
		return buildSwitchOutput(source, switchStmt, discriminant, outerClose);
	}

	const stmts = result.program.body;
	if (stmts.length === 0 || stmts[0].type !== 'SwitchStatement') return null;

	const switchStmt = stmts[0];
	const discriminant = source.slice(switchStmt.discriminant.start, switchStmt.discriminant.end);
	return buildSwitchOutput(source, switchStmt, discriminant, outerClose);
}

function buildSwitchOutput(source: string, switchStmt: any, discriminant: string, outerClose: number): ControlFlowResult {
	const switchCases = switchStmt.cases || [];

	// Group cases with fall-through support
	const groups: { values: string[]; isDefault: boolean; body: string }[] = [];
	let pendingValues: string[] = [];
	let pendingDefault = false;

	for (let ci = 0; ci < switchCases.length; ci++) {
		const sc = switchCases[ci];

		if (sc.test) {
			pendingValues.push(source.slice(sc.test.start, sc.test.end));
		} else {
			pendingDefault = true;
		}

		const consequent: any[] = sc.consequent || [];
		const bodyStmts = consequent.filter((s: any) => s.type !== 'BreakStatement' && s.type !== 'ReturnStatement');
		const hasBreak = consequent.some((s: any) => s.type === 'BreakStatement');
		const hasReturn = consequent.some((s: any) => s.type === 'ReturnStatement');
		const isLast = ci === switchCases.length - 1;

		// A case terminates its group if it has body content, a break/return, or is the last case
		if (bodyStmts.length > 0 || hasBreak || hasReturn || isLast) {
			let body = '';
			// For block-render: include the return statement in the body
			const allBodyStmts = hasReturn
				? consequent.filter((s: any) => s.type !== 'BreakStatement')
				: bodyStmts;
			if (allBodyStmts.length > 0) {
				const start = allBodyStmts[0].start;
				const end = allBodyStmts[allBodyStmts.length - 1].end;
				body = source.slice(start, end);
			}

			groups.push({
				values: [...pendingValues],
				isDefault: pendingDefault,
				body: body.trim(),
			});
			pendingValues = [];
			pendingDefault = false;
		}
	}

	// Build __switch call: discriminant fn, then pairs of (values, body fn)
	const args: string[] = [`() => (${discriminant})`];
	for (const g of groups) {
		if (g.isDefault) {
			args.push('null');
		} else {
			args.push(`[${g.values.join(', ')}]`);
		}
		args.push(buildCFCallback(g.body));
	}

	const output = `__switch(${args.join(', ')})`;
	return { text: `{${output}}`, end: outerClose + 1 };
}

function tryParseTryBlock(code: string, outerBrace: number): ControlFlowResult | null {
	const outerClose = findMatchingBrace(code, outerBrace);
	const content = code.slice(outerBrace + 1, outerClose).trim();

	if (!content.startsWith('try')) return null;

	// Manually parse: try { ... } [pending { ... }] [catch (param) { ... }]
	// Can't use OXC because "pending { }" isn't valid JavaScript
	let pos = 3; // skip "try"
	while (pos < content.length && /\s/.test(content[pos])) pos++;
	if (content[pos] !== '{') return null;

	const tryBodyEnd = findMatchingBrace(content, pos);
	const tryBody = content.slice(pos + 1, tryBodyEnd).trim();
	pos = tryBodyEnd + 1;

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
			if (content[pos] !== '{') return null;
			const pendEnd = findMatchingBrace(content, pos);
			pendingBody = content.slice(pos + 1, pendEnd).trim();
			pos = pendEnd + 1;
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
			if (content[pos] !== '{') return null;
			const catchEnd = findMatchingBrace(content, pos);
			catchBody = content.slice(pos + 1, catchEnd).trim();
			pos = catchEnd + 1;
		} else {
			break;
		}
	}

	// Transform nested control flow in bodies
	const transformedTryBody = transformControlFlowBlocks(tryBody);
	const transformedCatchBody = catchBody ? transformControlFlowBlocks(catchBody) : null;
	const transformedPendingBody = pendingBody ? transformControlFlowBlocks(pendingBody) : null;

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
