/**
 * Phase 3 — Transform (jsx() runtime)
 *
 * Converts the analysis IR into JavaScript code using $.jsx() runtime calls
 * for DOM creation with fine-grained reactivity. No templates, no DOM navigation.
 */
import type {
	AnalysisResult,
	ComponentIR,
	StyleBlockIR,
	JSXNodeIR,
	JSXElementIR,
	JSXFragmentIR,
	JSXIfBlockIR,
	JSXForBlockIR,
	JSXSwitchBlockIR,
	JSXTryBlockIR,
	JSXAnonymousBlockIR,
	JSXAttrIR,
	JSXExpressionIR,
} from '../2-analyze';
import { wrapReadsInGet, transformEventHandler, transformBodyStatement } from './expr';
import { scopeHash, scopeAttr, rewriteScopedCSS, extractCSSVars, type CSSVar } from './css';

// Module-level proxy vars for current transform context (avoids threading through every function)
let currentProxyVars: Set<string> | undefined;
let currentDirectMemberAccessVars: Set<string> | undefined;
/** Scope data attribute strings for the component currently being transformed (for render prop injection) */
let currentScopeAttrs: string[] | undefined;

// ── Main entry ─────────────────────────────────────────────────────

export interface TransformResult {
	code: string;
	/** Collected CSS fragments from all components (for external mode) */
	css: string;
}

export function transform(analysis: AnalysisResult, filename?: string, cssMode?: 'injected' | 'external'): TransformResult {
	const lines: string[] = [];
	const cssFragments: string[] = [];
	const emitStyleCalls = cssMode !== 'external'; // default: injected
	const moduleDirectMemberAccessVars = new Set<string>(analysis.moduleProxyVars);
	for (const d of analysis.moduleDerivedVars) moduleDirectMemberAccessVars.add(d.name);

	const needsRuntime =
		analysis.components.length > 0 ||
		analysis.nestedComponents.length > 0 ||
		analysis.moduleStateVars.length > 0 ||
		analysis.moduleDerivedVars.length > 0 ||
		analysis.moduleFunctions.length > 0;
	if (needsRuntime) {
		lines.push("import $ from 'dartsx/internal/client';");
	}

	for (const imp of analysis.userImports) {
		lines.push(imp);
	}
	if (lines.length > 0) lines.push('');

	for (const s of analysis.moduleStateVars) {
		const prefix = s.exported ? 'export ' : '';
		lines.push(`${prefix}let ${s.name} = $.state(${s.initExpr});`);
	}

	for (const d of analysis.moduleDerivedVars) {
		const prefix = d.exported ? 'export ' : '';
		const wrappedExpr = wrapReadsInGet(d.expr, analysis.moduleReactiveVars, analysis.moduleProxyVars, moduleDirectMemberAccessVars);
		lines.push(`${prefix}const ${d.name} = $.derived(() => ${wrappedExpr});`);
	}

	if (analysis.moduleStateVars.length > 0 || analysis.moduleDerivedVars.length > 0) {
		lines.push('');
	}

	for (const fn of analysis.moduleFunctions) {
		const mergedReactive = new Set(analysis.moduleReactiveVars);
		for (const p of fn.reactiveParams) mergedReactive.add(p);
		lines.push(fn.signature);
		for (const stmt of fn.bodyStatements) {
			lines.push(`    ${transformBodyStatement(stmt, mergedReactive, analysis.reactiveCallTargets, analysis.moduleProxyVars, moduleDirectMemberAccessVars)}`);
		}
		lines.push('}');
	}
	if (analysis.moduleFunctions.length > 0) lines.push('');

	// Group nested components by their parent statement index
	const nestedByIndex = new Map<number, typeof analysis.nestedComponents>();
	for (const nc of analysis.nestedComponents) {
		if (!nestedByIndex.has(nc.statementIndex)) {
			nestedByIndex.set(nc.statementIndex, []);
		}
		nestedByIndex.get(nc.statementIndex)!.push(nc);
	}

	for (let i = 0; i < analysis.moduleStatements.length; i++) {
		let stmt = analysis.moduleStatements[i];
		const nested = nestedByIndex.get(i);

		if (nested) {
			// Replace nested component source spans with placeholders, then splice in compiled code after
			const sorted = [...nested].sort((a, b) => b.localStart - a.localStart);
			const placeholders: Array<{ placeholder: string; compiled: string }> = [];

			for (let j = 0; j < sorted.length; j++) {
				const nc = sorted[j];
				const compiled = transformComponent(nc.ir, analysis.reactiveCallTargets, filename, cssFragments, emitStyleCalls);
				const placeholder = `__DARTSX_NC_${j}__`;
				placeholders.push({ placeholder, compiled });
				stmt = stmt.slice(0, nc.localStart) + placeholder + stmt.slice(nc.localEnd);
			}

			// Apply reactive var transformations to the non-component parts
			stmt = transformBodyStatement(stmt, analysis.moduleReactiveVars, analysis.reactiveCallTargets, analysis.moduleProxyVars, moduleDirectMemberAccessVars);

			// Replace placeholders with compiled component code
			for (const { placeholder, compiled } of placeholders) {
				stmt = stmt.replace(placeholder, compiled);
			}

			lines.push(stmt);
		} else {
			lines.push(transformBodyStatement(stmt, analysis.moduleReactiveVars, analysis.reactiveCallTargets, analysis.moduleProxyVars, moduleDirectMemberAccessVars));
		}
	}
	if (analysis.moduleStatements.length > 0) lines.push('');

	for (const comp of analysis.components) {
		lines.push(transformComponent(comp, analysis.reactiveCallTargets, filename, cssFragments, emitStyleCalls));
		lines.push('');
	}

	return {
		code: lines.join('\n'),
		css: cssFragments.join('\n'),
	};
}

// ── Component code generation ──────────────────────────────────────

function transformComponent(comp: ComponentIR, reactiveCallTargets?: Map<string, Set<number>>, filename?: string, cssFragments?: string[], emitStyleCalls = true): string {
	const lines: string[] = [];
	const hasProps = comp.params.length > 0;
	currentProxyVars = comp.proxyVars.size > 0 ? comp.proxyVars : undefined;
	const directMemberAccessVars = new Set<string>(comp.proxyVars);
	for (const d of comp.derivedVars) directMemberAccessVars.add(d.name);
	for (const p of comp.params) {
		if (!p.isRest) directMemberAccessVars.add(p.name);
	}
	currentDirectMemberAccessVars = directMemberAccessVars.size > 0 ? directMemberAccessVars : undefined;

	// Process style blocks — compute hashes and inject data attributes
	const scopedStyles = processScopeStyles(comp.styleBlocks, comp.meta.name, filename || 'input.tsx');
	const scopeAttrList = scopedStyles.filter(s => s.attr).map(s => s.attr);
	currentScopeAttrs = scopeAttrList.length > 0 ? scopeAttrList : undefined;
	if (scopedStyles.length > 0) {
		injectScopeAttrsIntoTree(comp.jsx, scopedStyles);
	}

	// Collect CSS for external output
	for (const ss of scopedStyles) {
		if (cssFragments) {
			cssFragments.push(ss.css);
		}
	}

	const exportPrefix = comp.meta.isExport
		? comp.meta.isDefault
			? 'export default '
			: 'export '
		: '';
	const asyncPrefix = comp.meta.isAsync ? 'async ' : '';
	const propsParam = hasProps ? '$$props' : '';
	lines.push(`${exportPrefix}${asyncPrefix}function ${comp.meta.name}(${propsParam}) {`);

	// Emit $.style() calls for injected mode
	if (emitStyleCalls) {
		for (const ss of scopedStyles) {
			lines.push(`    $.style(${JSON.stringify(ss.hash)}, ${JSON.stringify(ss.css)});`);
		}
		if (scopedStyles.length > 0) lines.push('');
	}

	if (hasProps) {
		for (const p of comp.params) {
			if (p.isRest) {
				lines.push(`    let ${p.name} = $$props;`);
			} else if (p.isBind) {
				const propKey = p.externalName || p.name;
				const args = p.defaultValue
					? `$$props, '${propKey}', ${p.defaultValue}`
					: `$$props, '${propKey}'`;
				lines.push(`    let ${p.name} = $.prop.bind(${args});`);
			} else {
				const propKey = p.externalName || p.name;
				const args = p.defaultValue
					? `$$props, '${propKey}', ${p.defaultValue}`
					: `$$props, '${propKey}'`;
				lines.push(`    const ${p.name} = $.prop(${args});`);
			}
		}
	}

	if (hasProps) {
		lines.push('');
	}

	for (const decl of comp.orderedDecls) {
		if (decl.kind === 'state') {
			lines.push(`    let ${decl.name} = $.state(${decl.initExpr});`);
		} else if (decl.kind === 'derived') {
			if (decl.raw) {
				const wrappedExpr = wrapReadsInGet(decl.expr, comp.reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
				lines.push(`    const ${decl.name} = ${wrappedExpr};`);
			} else {
				const wrappedExpr = wrapReadsInGet(decl.expr, comp.reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
				lines.push(`    const ${decl.name} = $.derived(() => ${wrappedExpr});`);
			}
		} else {
			lines.push(`    ${transformBodyStatement(decl.text, comp.reactiveVars, reactiveCallTargets, currentProxyVars, currentDirectMemberAccessVars)}`);
		}
	}

	const allCssVars = scopedStyles.flatMap(ss => ss.cssVars);
	const jsxCode = emitJSXNode(comp.jsx, comp.reactiveVars, '    ');

	if (allCssVars.length > 0) {
		// Group CSS vars by their scoped selector for surgical per-element placement
		const varsBySelector = new Map<string, CSSVar[]>();
		for (const v of allCssVars) {
			const sel = v.selector || '';
			if (!varsBySelector.has(sel)) varsBySelector.set(sel, []);
			varsBySelector.get(sel)!.push(v);
		}

		lines.push(`    var $$root = ${jsxCode};`);
		lines.push(`    $.cssVars($$root, [`);
		for (const [selector, vars] of varsBySelector) {
			const entries = vars.map(v => {
				const wrappedExpr = wrapReadsInGet(v.expr, comp.reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
				if (v.suffix) {
					return `            ${JSON.stringify(v.varName)}: () => ${wrappedExpr} + ${JSON.stringify(v.suffix)}`;
				}
				return `            ${JSON.stringify(v.varName)}: () => ${wrappedExpr}`;
			});
			lines.push(`        [${JSON.stringify(selector)}, {`);
			lines.push(entries.join(',\n'));
			lines.push(`        }],`);
		}
		lines.push(`    ]);`);
		lines.push(`    return $$root;`);
	} else {
		lines.push(`    return ${jsxCode};`);
	}
	lines.push('}');
	currentDirectMemberAccessVars = undefined;
	currentScopeAttrs = undefined;

	return lines.join('\n');
}

// ── Scoped CSS Processing ──────────────────────────────────────────

interface ProcessedStyle {
	hash: string;
	attr: string;
	css: string;
	/** Path of child indices from root to the scope's parent element.
	 *  Empty = root-level (applies to all elements). */
	scopePath: number[];
	/** Reactive CSS variable bindings */
	cssVars: CSSVar[];
}

/**
 * Process style blocks: generate hashes, extract reactive vars, rewrite CSS selectors.
 */
function processScopeStyles(blocks: StyleBlockIR[], componentName: string, filename: string): ProcessedStyle[] {
	const results: ProcessedStyle[] = [];
	for (const block of blocks) {
		const hashInput = `${filename}::${componentName}::${block.index}`;
		const hash = scopeHash(hashInput);
		let css = dedentCSS(block.css);

		// Extract reactive {expression} values from CSS property values (via PostCSS)
		const extracted = extractCSSVars(css, hash);
		css = extracted.css;

		if (block.isGlobal) {
			results.push({ hash, attr: '', css, scopePath: block.scopePath, cssVars: extracted.cssVars });
			continue;
		}
		const attr = scopeAttr(hash);
		const { css: rewrittenCSS, varSelectors } = rewriteScopedCSS(css, hash);
		// Merge scoped selectors into cssVars for surgical per-element placement
		for (const v of extracted.cssVars) {
			v.selector = varSelectors.get(v.varName);
		}
		results.push({ hash, attr, css: rewrittenCSS, scopePath: block.scopePath, cssVars: extracted.cssVars });
	}
	return results;
}

function dedentCSS(css: string): string {
	const lines = css.split('\n');
	while (lines.length > 0 && lines[0].trim() === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	if (lines.length === 0) return '';
	let minIndent = Infinity;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
		if (indent < minIndent) minIndent = indent;
	}
	if (minIndent === 0 || minIndent === Infinity) return lines.join('\n');
	return lines.map(l => l.slice(minIndent)).join('\n');
}

/**
 * Walk the JSX IR tree and inject scope data attributes into element attribute lists.
 *
 * For root-level styles (scopePath=[]): add to ALL elements.
 * For nested styles: follow the scopePath to the target element, then inject from there.
 */
function injectScopeAttrsIntoTree(node: JSXNodeIR, styles: ProcessedStyle[]): void {
	// Collect only scoped attrs (non-empty attr means it's scoped, not global)
	const scopedStyles = styles.filter(s => s.attr);
	if (scopedStyles.length === 0) return;

	// Separate root-level styles from nested styles
	const rootAttrs = scopedStyles.filter(s => s.scopePath.length === 0).map(s => s.attr);
	const nestedStyles = scopedStyles.filter(s => s.scopePath.length > 0);

	// Inject root-level attrs into all elements
	if (rootAttrs.length > 0) {
		injectAttrsRecursive(node, rootAttrs);
	}

	// For each nested style, navigate to the target element and inject from there
	for (const style of nestedStyles) {
		const targetNode = navigateToNode(node, style.scopePath);
		if (targetNode) {
			// Inject into children of the target element (siblings of the <style> block)
			injectAttrsRecursive(targetNode, [style.attr]);
		}
	}
}

/**
 * Navigate the IR tree following a scopePath to find the target element node.
 * The scopePath is an array of child indices through JSXElement nodes.
 */
function navigateToNode(node: JSXNodeIR, path: number[]): JSXNodeIR | null {
	let current = node;
	for (const childIdx of path) {
		const children = current.type === 'element' ? (current as JSXElementIR).children
			: current.type === 'fragment' ? (current as JSXFragmentIR).children
				: null;
		if (!children) return null;
		// Find the childIdx-th element node among IR children
		// (OXC counts only JSXElement children, IR may also have text/expr nodes)
		let elementCount = -1;
		let found = false;
		for (const child of children) {
			if (child.type === 'element') {
				elementCount++;
				if (elementCount === childIdx) {
					current = child;
					found = true;
					break;
				}
			}
		}
		if (!found) return null;
	}
	return current;
}

function injectAttrsRecursive(node: JSXNodeIR, attrs: string[]): void {
	if (node.type === 'element' && !(node as JSXElementIR).isComponent) {
		const el = node as JSXElementIR;
		for (const attr of attrs) {
			el.attributes.push({ kind: 'static', name: attr, value: '' });
		}
		for (const child of el.children) {
			injectAttrsRecursive(child, attrs);
		}
	} else if (node.type === 'element' && (node as JSXElementIR).isComponent) {
		// Recurse into children of component elements — they were authored by
		// the parent and should receive the parent's scope attribute.
		const el = node as JSXElementIR;
		for (const child of el.children) {
			injectAttrsRecursive(child, attrs);
		}
	} else if (node.type === 'fragment') {
		for (const child of (node as JSXFragmentIR).children) {
			injectAttrsRecursive(child, attrs);
		}
	} else if (node.type === 'if_block') {
		const block = node as JSXIfBlockIR;
		for (const child of block.trueBranch) injectAttrsRecursive(child, attrs);
		if (block.falseBranch) {
			for (const child of block.falseBranch) injectAttrsRecursive(child, attrs);
		}
	} else if (node.type === 'for_block') {
		const block = node as JSXForBlockIR;
		for (const child of block.body) injectAttrsRecursive(child, attrs);
	} else if (node.type === 'switch_block') {
		const block = node as JSXSwitchBlockIR;
		for (const c of block.cases) {
			for (const child of c.body) injectAttrsRecursive(child, attrs);
		}
	} else if (node.type === 'try_block') {
		const block = node as JSXTryBlockIR;
		for (const child of block.tryBranch) injectAttrsRecursive(child, attrs);
		if (block.catchBranch) {
			for (const child of block.catchBranch) injectAttrsRecursive(child, attrs);
		}
		if (block.pendingBranch) {
			for (const child of block.pendingBranch) injectAttrsRecursive(child, attrs);
		}
	} else if (node.type === 'anonymous_block') {
		const block = node as JSXAnonymousBlockIR;
		for (const child of block.children) injectAttrsRecursive(child, attrs);
	}
}

// ── JSX node emission ──────────────────────────────────────────────

function emitJSXNode(node: JSXNodeIR, reactiveVars: Set<string>, indent: string): string {
	switch (node.type) {
		case 'element':
			return emitElement(node, reactiveVars, indent);
		case 'fragment':
			return emitFragment(node, reactiveVars, indent);
		case 'text': {
			const text = normalizeJSXText(node.value, true, true);
			if (text.length === 0) return 'null';
			return JSON.stringify(text);
		}
		case 'expression':
			return emitChildExpression(node, reactiveVars);
		case 'if_block':
			return emitIfBlock(node, reactiveVars, indent);
		case 'for_block':
			return emitForBlock(node, reactiveVars, indent);
		case 'switch_block':
			return emitSwitchBlock(node, reactiveVars, indent);
		case 'try_block':
			return emitTryBlock(node, reactiveVars, indent);
		case 'anonymous_block':
			return emitAnonymousBlock(node, reactiveVars, indent);
		default:
			return 'null';
	}
}

function emitFragment(node: JSXFragmentIR, reactiveVars: Set<string>, indent: string): string {
	const childStrs = emitChildrenArray(node.children, reactiveVars, indent);
	if (childStrs.length === 0) return 'null';
	if (childStrs.length === 1) return childStrs[0];
	return `$.jsx($.Fragment, { children: [${childStrs.join(', ')}] })`;
}

function emitElement(node: JSXElementIR, reactiveVars: Set<string>, indent: string): string {
	if (node.isComponent) return emitComponentCall(node, reactiveVars, indent);

	const propEntries: string[] = [];

	for (const attr of node.attributes) {
		emitAttr(attr, propEntries, reactiveVars, false);
	}

	if (!node.selfClosing) {
		const childStrs = emitChildrenArray(node.children, reactiveVars, indent);
		if (childStrs.length > 0) {
			propEntries.push(`children: [${childStrs.join(', ')}]`);
		}
	}

	if (propEntries.length === 0) {
		return `$.jsx("${node.tag}")`;
	}
	return `$.jsx("${node.tag}", { ${propEntries.join(', ')} })`;
}

function emitComponentCall(node: JSXElementIR, reactiveVars: Set<string>, indent: string): string {
	const propEntries: string[] = [];

	for (const attr of node.attributes) {
		emitAttr(attr, propEntries, reactiveVars, true);
	}

	if (!node.selfClosing) {
		const childStrs = emitChildrenArray(node.children, reactiveVars, indent);
		if (childStrs.length > 0) {
			propEntries.push(`children: [${childStrs.join(', ')}]`);
		}
	}

	if (propEntries.length === 0) {
		return `$.jsx(${node.tag})`;
	}
	return `$.jsx(${node.tag}, { ${propEntries.join(', ')} })`;
}

// ── Attribute emission ─────────────────────────────────────────────

function emitAttr(attr: JSXAttrIR, entries: string[], reactiveVars: Set<string>, isComponent: boolean): void {
	const key = formatObjectKey(attr.name);
	switch (attr.kind) {
		case 'static': {
			const val = attr.value === 'true' ? 'true' : JSON.stringify(attr.value || '');
			entries.push(`${key}: ${val}`);
			break;
		}
		case 'dynamic': {
			let wrapped = wrapReadsInGet(attr.value || '', reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
			// Inject scope data attributes into JSX within render props
			if (currentScopeAttrs && currentScopeAttrs.length > 0) {
				wrapped = injectScopeAttrsIntoJSXSource(wrapped, currentScopeAttrs);
			}
			const isReactive = wrapped !== (attr.value || '') || containsReactiveVar(attr.value || '', reactiveVars);
			if (isReactive && isComponent) {
				// Use object getter so callback functions aren't confused with reactive getters
				entries.push(`get ${key}() { return ${wrapped}; }`);
			} else if (isReactive) {
				entries.push(`${key}: () => ${wrapArrowBody(wrapped)}`);
			} else {
				entries.push(`${key}: ${attr.value}`);
			}
			break;
		}
		case 'event': {
			const handler = transformEventHandler(attr.value || '', reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
			entries.push(`${key}: ${handler}`);
			break;
		}
		case 'bind': {
			if (attr.bindProperty) {
				if (attr.bindGetter !== undefined && attr.bindSetter !== undefined) {
					// Function binding: bind:value={getter, setter}
					const getter = wrapReadsInGet(attr.bindGetter, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
					const setter = transformEventHandler(attr.bindSetter, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
					entries.push(`${formatObjectKey(`bind:${attr.bindProperty}`)}: [${getter}, ${setter}]`);
				} else if (attr.value) {
					const val = attr.value;
					const getter = wrapReadsInGet(val, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
					const setter = transformEventHandler(`(v) => ${val} = v`, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
					entries.push(`${formatObjectKey(`bind:${attr.bindProperty}`)}: [() => ${getter}, ${setter}]`);
				}
			}
			break;
		}
		case 'spread': {
			entries.push(`...${attr.value}`);
			break;
		}
	}
}

// ── Children ───────────────────────────────────────────────────────

function emitChildrenArray(children: JSXNodeIR[], reactiveVars: Set<string>, indent: string): string[] {
	const result: string[] = [];

	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const isFirst = i === 0;
		const isLast = i === children.length - 1;

		if (child.type === 'text') {
			const text = normalizeJSXText(child.value, isFirst, isLast);
			if (text.length === 0) continue;
			// Drop whitespace-only text nodes between non-text siblings (just formatting)
			if (text.trim().length === 0 && !isFirst && !isLast) {
				const prev = children[i - 1];
				const next = children[i + 1];
				if (prev.type !== 'text' && prev.type !== 'expression' &&
					next.type !== 'text' && next.type !== 'expression') {
					continue;
				}
			}
			result.push(JSON.stringify(text));
			continue;
		}

		if (child.type === 'expression') {
			result.push(emitChildExpression(child, reactiveVars));
			continue;
		}

		result.push(emitJSXNode(child, reactiveVars, indent));
	}

	return result;
}

function emitChildExpression(node: JSXExpressionIR, reactiveVars: Set<string>): string {
	const wrapped = wrapReadsInGet(node.raw, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
	if (wrapped !== node.raw || containsReactiveVar(node.raw, reactiveVars)) {
		return `() => ${wrapArrowBody(wrapped)}`;
	}
	return node.raw;
}

// ── Control flow ───────────────────────────────────────────────────

/**
 * Emits an arrow-function callback for a CF branch.
 * When preamble is present, produces a block-body arrow:
 *   (params) => { preamble; return jsxExpr; }
 * Otherwise produces an expression-body arrow:
 *   (params) => jsxExpr
 */
function emitCFCallback(
	children: JSXNodeIR[],
	reactiveVars: Set<string>,
	indent: string,
	params?: string,
	preamble?: string,
): string {
	const arrow = params ? `(${params}) =>` : `() =>`;
	const bodyExpr = emitBranchReturn(children, reactiveVars, indent);
	if (preamble) {
		const transformedPreamble = transformBodyStatement(preamble, reactiveVars, undefined, currentProxyVars, currentDirectMemberAccessVars);
		return `${arrow} { ${transformedPreamble} return ${bodyExpr}; }`;
	}
	return `${arrow} ${bodyExpr}`;
}

function emitIfBlock(node: JSXIfBlockIR, reactiveVars: Set<string>, indent: string): string {
	const condExpr = wrapReadsInGet(node.condition, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
	const trueCallback = emitCFCallback(node.trueBranch, reactiveVars, indent, undefined, node.truePreamble);

	let result = `$.if(() => ${condExpr}, ${trueCallback}`;
	if (node.falseBranch) {
		const falseCallback = emitCFCallback(node.falseBranch, reactiveVars, indent, undefined, node.falsePreamble);
		result += `, ${falseCallback}`;
	}
	result += ')';
	return result;
}

function emitForBlock(node: JSXForBlockIR, reactiveVars: Set<string>, indent: string): string {
	const collExpr = node.collection.trimStart().startsWith('{')
		? transformBodyStatement(node.collection, reactiveVars, undefined, currentProxyVars, currentDirectMemberAccessVars)
		: wrapReadsInGet(node.collection, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
	const params = node.indexName ? `${node.itemName}, ${node.indexName}` : node.itemName;
	const bodyCallback = emitCFCallback(node.body, reactiveVars, indent, params, node.preamble);

	let result = `$.for(() => ${collExpr}, ${bodyCallback}`;
	if (node.keyExpr) {
		const keyExpr = wrapReadsInGet(node.keyExpr, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);
		result += `, (${node.itemName}) => ${keyExpr}`;
	}
	result += ')';
	return result;
}

function emitSwitchBlock(node: JSXSwitchBlockIR, reactiveVars: Set<string>, indent: string): string {
	const discExpr = wrapReadsInGet(node.discriminant, reactiveVars, currentProxyVars, currentDirectMemberAccessVars);

	const caseStrs: string[] = [];
	for (const c of node.cases) {
		const valuesStr = c.values === null ? 'null' : `[${c.values.join(', ')}]`;
		const fnCallback = emitCFCallback(c.body, reactiveVars, indent, undefined, c.preamble);
		caseStrs.push(`{ values: ${valuesStr}, fn: ${fnCallback} }`);
	}

	return `$.switch(() => ${discExpr}, [${caseStrs.join(', ')}])`;
}

function emitTryBlock(node: JSXTryBlockIR, reactiveVars: Set<string>, indent: string): string {
	const tryCallback = emitCFCallback(node.tryBranch, reactiveVars, indent, undefined, node.tryPreamble);

	let result = `$.try(${tryCallback}`;

	if (node.catchBranch) {
		const param = node.catchParam || 'e';
		const catchCallback = emitCFCallback(node.catchBranch, reactiveVars, indent, param, node.catchPreamble);
		result += `, ${catchCallback}`;
	} else if (node.pendingBranch) {
		result += ', undefined';
	}

	if (node.pendingBranch) {
		const pendCallback = emitCFCallback(node.pendingBranch, reactiveVars, indent, undefined, node.pendingPreamble);
		result += `, ${pendCallback}`;
	}

	result += ')';
	return result;
}

function emitAnonymousBlock(node: JSXAnonymousBlockIR, reactiveVars: Set<string>, indent: string): string {
	const bodyExpr = emitBranchReturn(node.children, reactiveVars, indent);
	if (node.preamble) {
		const transformedPreamble = transformBodyStatement(node.preamble, reactiveVars, undefined, currentProxyVars, currentDirectMemberAccessVars);
		return `() => { ${transformedPreamble} return ${bodyExpr}; }`;
	}
	return bodyExpr;
}

// ── Branch helpers ─────────────────────────────────────────────────

function emitBranchReturn(children: JSXNodeIR[], reactiveVars: Set<string>, indent: string): string {
	const childStrs = emitChildrenArray(children, reactiveVars, indent);
	if (childStrs.length === 0) return 'null';
	if (childStrs.length === 1) return childStrs[0];
	return `$.jsx($.Fragment, { children: [${childStrs.join(', ')}] })`;
}

// ── Utilities ──────────────────────────────────────────────────────

/** Check if an expression contains any reactive variable as a word boundary match */
function containsReactiveVar(expr: string, reactiveVars: Set<string>): boolean {
	for (const v of reactiveVars) {
		// Use word boundary check to avoid matching substrings
		const re = new RegExp(`\\b${v}\\b`);
		if (re.test(expr)) return true;
	}
	return false;
}

/** Parenthesize an expression if it starts with `{` so `() => {...}` becomes `() => ({...})` */
function wrapArrowBody(expr: string): string {
	const trimmed = expr.trimStart();
	if (trimmed.startsWith('{')) return `(${expr})`;
	return expr;
}

/**
 * Inject scope data attributes into JSX opening tags within a source expression.
 * Handles JSX like `<th>Name</th>` → `<th data-dartsx-abc="">Name</th>`.
 * Only injects into HTML element tags (lowercase), not component tags (uppercase).
 */
function injectScopeAttrsIntoJSXSource(source: string, scopeAttrs: string[]): string {
	const attrStr = scopeAttrs.map(a => ` ${a}=""`).join('');
	// Match JSX opening tags: <tagname (lowercase start), capture up to > or />
	return source.replace(/<([a-z][a-zA-Z0-9]*)([\s/>])/g, (match, tag, after) => {
		return `<${tag}${attrStr}${after}`;
	});
}

function formatObjectKey(key: string): string {
	return /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
}

function normalizeJSXText(text: string, isFirst: boolean, isLast: boolean): string {
	let result = text.replace(/\s*\n\s*/g, ' ');
	if (isFirst) result = result.replace(/^\s+/, '');
	if (isLast) result = result.replace(/\s+$/, '');
	return result;
}
