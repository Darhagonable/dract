/**
 * CSS scoping utilities for the DarTsx compiler.
 *
 * Uses PostCSS for robust CSS AST processing (like Vue's compiler-sfc)
 * and postcss-selector-parser for selector rewriting.
 *
 * Handles:
 * - Scope hash generation (deterministic, DJB2)
 * - CSS selector rewriting (append [data-dartsx-hash])
 * - @keyframes name hash-prefixing
 * - :global() extraction
 * - :deep() handling
 * - Reactive CSS variable extraction ({expression} → var(--dartsx-hash-N))
 */
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

// ── Scope Hash ─────────────────────────────────────────────────────

/**
 * Generate a short deterministic hash for a scope identifier.
 * Uses djb2 algorithm — fast and produces well-distributed values.
 */
export function scopeHash(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
	}
	return hash.toString(36).slice(0, 7);
}

/**
 * Generate the data attribute name for a scope hash.
 */
export function scopeAttr(hash: string): string {
	return `data-dartsx-${hash}`;
}

// ── Reactive CSS Variable Extraction ───────────────────────────────

export interface CSSVar {
	varName: string;
	expr: string;
	suffix: string;
	/** Scoped CSS selector for surgical placement (set via PostCSS scan after rewriting). */
	selector?: string;
}

/**
 * Extract `{expression}suffix` patterns from CSS declaration values
 * and replace with `var(--dartsx-hash-N)`.
 *
 * Runs as a text pre-pass before PostCSS parsing, since `{expr}` is
 * invalid CSS that PostCSS can't parse. Only replaces inside property
 * values (after `:` within rule bodies), never in selectors or at-rule
 * prelude — tracked via brace-depth counting.
 */
export function extractCSSVars(css: string, hash: string): { css: string; cssVars: CSSVar[] } {
	const cssVars: CSSVar[] = [];
	/** Dedup: map "expr\0suffix" → existing varName so identical expressions share one CSS var */
	const seen = new Map<string, string>();
	let varCounter = 0;
	let result = '';
	let i = 0;
	let insideRule = 0;
	let insideValue = false;

	while (i < css.length) {
		const ch = css[i];

		if (ch === '{' && !insideValue) {
			insideRule++;
			result += ch;
			i++;
			continue;
		}
		if (ch === '}' && !insideValue) {
			insideRule--;
			result += ch;
			i++;
			continue;
		}
		if (insideRule > 0 && ch === ':' && !insideValue) {
			insideValue = true;
			result += ch;
			i++;
			continue;
		}
		if (insideValue && (ch === ';' || ch === '}')) {
			insideValue = false;
			if (ch === '}') insideRule--;
			result += ch;
			i++;
			continue;
		}
		if (insideValue && ch === '{') {
			const closeIdx = css.indexOf('}', i + 1);
			if (closeIdx === -1) { result += ch; i++; continue; }
			const expr = css.slice(i + 1, closeIdx).trim();
			let suffixEnd = closeIdx + 1;
			while (suffixEnd < css.length && /[a-zA-Z%]/.test(css[suffixEnd])) suffixEnd++;
			const suffix = css.slice(closeIdx + 1, suffixEnd);
			const dedup = `${expr}\0${suffix}`;
			let varName = seen.get(dedup);
			if (!varName) {
				varName = `--dartsx-${hash}-${varCounter++}`;
				seen.set(dedup, varName);
				cssVars.push({ varName, expr, suffix });
			}
			result += `var(${varName})`;
			i = suffixEnd;
			continue;
		}
		result += ch;
		i++;
	}

	return { css: result, cssVars };
}

// ── CSS Selector Rewriting ─────────────────────────────────────────

/**
 * Rewrite all CSS in a scoped style block:
 * - Append [data-dartsx-hash] to selectors
 * - Hash-prefix @keyframes names
 * - Rewrite animation references
 * - Strip :global() wrappers
 * - Handle :deep()
 */
export function rewriteScopedCSS(css: string, hash: string): { css: string; varSelectors: Map<string, string> } {
	const attr = `[data-dartsx-${hash}]`;
	const keyframeNames = new Map<string, string>();

	const root = postcss.parse(css, { from: undefined });

	root.walk(node => {
		// @keyframes — hash-prefix the name
		if (node.type === 'atrule' && node.name === 'keyframes') {
			const original = node.params.trim();
			const hashed = `${hash}-${original}`;
			keyframeNames.set(original, hashed);
			node.params = hashed;
			return;
		}

		// Rules — rewrite selectors (skip keyframe stops like from/to/0%/100%)
		if (node.type === 'rule') {
			const parent = node.parent;
			if (parent?.type === 'atrule' && (parent as postcss.AtRule).name === 'keyframes') {
				return;
			}
			node.selector = rewriteRuleSelector(node.selector, attr);
		}

		// Declarations — rewrite animation references
		if (node.type === 'decl' && keyframeNames.size > 0) {
			if (node.prop === 'animation' || node.prop === 'animation-name') {
				for (const [original, hashed] of keyframeNames) {
					node.value = node.value.replace(
						new RegExp(`\\b${escapeRegex(original)}\\b`, 'g'),
						hashed,
					);
				}
			}
		}
	});

	// Scan for var(--dartsx-HASH-N) references and map each to its rule's scoped selector.
	// A deduplicated var may appear in multiple rules, so collect all selectors.
	const varSelectorSets = new Map<string, Set<string>>();
	const varRefPattern = new RegExp(`var\\((--dartsx-${escapeRegex(hash)}-\\d+)\\)`, 'g');
	root.walkDecls(decl => {
		const rule = decl.parent;
		if (rule?.type !== 'rule') return;
		for (const match of decl.value.matchAll(varRefPattern)) {
			const varName = match[1];
			if (!varSelectorSets.has(varName)) varSelectorSets.set(varName, new Set());
			// Strip pseudo-elements (::before, ::after) — can't querySelectorAll on them
			const sel = (rule as postcss.Rule).selector.replace(/::[\w-]+(\(.*?\))?/g, '').trim();
			if (sel) varSelectorSets.get(varName)!.add(sel);
		}
	});
	const varSelectors = new Map<string, string>();
	for (const [varName, sels] of varSelectorSets) {
		varSelectors.set(varName, [...sels].join(', '));
	}

	let result = root.toString();
	if (result.length > 0 && !result.endsWith('\n')) result += '\n';
	return { css: result, varSelectors };
}

/**
 * Rewrite a rule's selector string using postcss-selector-parser.
 * Handles comma-separated selectors, combinators, :global(), :deep().
 */
function rewriteRuleSelector(selector: string, attr: string): string {
	return selectorParser(root => {
		const skipSelectors = new Set<selectorParser.Selector>();

		root.walk(node => {
			// :global(...) — unwrap and skip scoping
			if (node.type === 'pseudo' && node.value === ':global') {
				const inner = node.nodes?.[0];
				const parentSel = node.parent as selectorParser.Selector | undefined;
				if (inner && parentSel) {
					if (parentSel.nodes.length === 1 && parentSel.nodes[0] === node) {
						// Entire selector is :global(...) — unwrap and skip scoping
						parentSel.nodes = [];
						for (const n of inner.nodes) parentSel.append(n.clone());
						skipSelectors.add(parentSel);
					} else {
						// Partial :global() — unwrap in place
						node.replaceWith(...inner.nodes.map(n => n.clone()));
					}
				}
				return;
			}

			// :deep(...) — scope before, unscope after
			if (node.type === 'pseudo' && node.value === ':deep') {
				const parent = node.parent as selectorParser.Selector | undefined;
				if (!parent) return;

				const idx = parent.index(node);
				const before = parent.nodes.slice(0, idx);
				const innerNodes = node.nodes?.[0]?.nodes ?? [];
				const after = parent.nodes.slice(idx + 1);

				// Build new selector: before[attr] innerNodes after
				const newNodes: selectorParser.Node[] = [];

				if (before.length > 0) {
					const lastBefore = before[before.length - 1];
					if (lastBefore.type === 'combinator') {
						// Attach attr to element before combinator: .wrapper[attr] .child
						newNodes.push(...before.slice(0, -1).map(n => n.clone()));
						newNodes.push(attrSelector(attr.slice(1, -1)));
						newNodes.push(lastBefore.clone());
					} else {
						newNodes.push(...before.map(n => n.clone()));
						newNodes.push(attrSelector(attr.slice(1, -1)));
					}
				} else {
					newNodes.push(attrSelector(attr.slice(1, -1)));
				}
				if (innerNodes.length > 0) {
					// Add space combinator if not already present
					const lastBefore = newNodes[newNodes.length - 1];
					if (lastBefore && lastBefore.type !== 'combinator') {
						newNodes.push(selectorParser.combinator({ value: ' ' }) as any);
					}
					newNodes.push(...innerNodes.map((n: any) => n.clone()));
				}
				newNodes.push(...after.map(n => n.clone()));

				parent.nodes = [];
				for (const n of newNodes) parent.append(n as any);
				return;
			}
		});

		// Now scope selectors that weren't handled by :global/:deep
		root.each(selectorNode => {
			if (skipSelectors.has(selectorNode as selectorParser.Selector)) return;
			scopeSelector(selectorNode as selectorParser.Selector, attr);
		});
	}).processSync(selector);
}

/**
 * Add the scoping attribute to a single selector.
 *
 * - Subject (last compound) gets [attr] directly
 * - Non-subject compounds get :where([attr]) to avoid specificity inflation
 */
function scopeSelector(selector: selectorParser.Selector, attr: string): void {
	// Skip if already processed (contains our attr)
	if (selector.toString().includes(attr)) return;

	// Find compound boundary positions (split by combinators)
	const compounds: { start: number; end: number }[] = [];
	let compoundStart = 0;

	selector.each((node, i) => {
		if (node.type === 'combinator') {
			if (i > compoundStart) {
				compounds.push({ start: compoundStart, end: i });
			}
			compoundStart = i + 1;
		}
	});
	compounds.push({ start: compoundStart, end: selector.nodes.length });

	if (compounds.length === 0) return;

	// Walk compounds from right to left (last is subject)
	for (let c = compounds.length - 1; c >= 0; c--) {
		const compound = compounds[c];
		const isSubject = c === compounds.length - 1;

		// Find insertion point: before any pseudo-elements (::before, ::after)
		let insertIdx = compound.end;
		for (let i = compound.end - 1; i >= compound.start; i--) {
			const node = selector.at(i);
			if (node?.type === 'pseudo' && node.value?.startsWith('::')) {
				insertIdx = i;
			} else {
				break;
			}
		}

		const attrNode = attrSelector(attr.slice(1, -1));

		if (isSubject) {
			// Subject — append [attr] directly
			selector.nodes.splice(insertIdx, 0, attrNode as any);
		} else {
			// Non-subject — wrap in :where([attr])
			const wherePseudo = selectorParser.pseudo({ value: ':where' });
			const innerSel = selectorParser.selector({ value: '' });
			innerSel.append(attrNode);
			wherePseudo.append(innerSel);
			selector.nodes.splice(insertIdx, 0, wherePseudo as any);
		}

		// Adjust subsequent compound boundaries after insertion
		for (let j = c + 1; j < compounds.length; j++) {
			compounds[j].start++;
			compounds[j].end++;
		}
	}
}

// ── Helpers ────────────────────────────────────────────────────────

/** Create a presence attribute node like `[data-dartsx-xxx]` (Vue pattern: raws={} suppresses =value) */
function attrSelector(attribute: string): selectorParser.Attribute {
	return selectorParser.attribute({ attribute, value: attribute, raws: {}, quoteMark: '"' });
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
