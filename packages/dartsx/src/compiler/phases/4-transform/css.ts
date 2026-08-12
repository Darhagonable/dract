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
 * - Reactive CSS variable extraction ({expression} → var(--readable-name))
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
 * The attribute name used for component scoping.
 */
export const SCOPE_ATTR = 'data-scope';

// ── Reactive CSS Variable Extraction ───────────────────────────────

export interface CSSVar {
	varName: string;
	expr: string;
	suffix: string;
}

/** Convert camelCase to kebab-case: `accentColor` → `accent-color` */
function camelToKebab(s: string): string {
	return s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

/**
 * Generate a human-readable CSS custom property name from an expression.
 * - Simple identifier: `color` → `--color`, `accentColor` → `--accent-color`
 * - Complex expression: `size + height / 2` → `--size-height-<hash>`
 * Appends a numeric suffix if the name is already taken within the component.
 */
function cssVarName(expr: string, usedNames: Set<string>): string {
	const ids = expr.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) ?? [];
	const kebabIds = [...new Set(ids.map(camelToKebab))];
	const isSimple = ids.length === 1 && expr.trim() === ids[0];

	let base: string;
	if (kebabIds.length === 0) {
		base = '--v';
	} else if (isSimple) {
		base = `--${kebabIds[0]}`;
	} else {
		// Complex expression: identifiers + short hash for uniqueness
		let h = 5381;
		for (let i = 0; i < expr.length; i++) h = ((h << 5) + h + expr.charCodeAt(i)) >>> 0;
		base = `--${kebabIds.join('-')}-${h.toString(36).slice(0, 4)}`;
	}

	// Collision guard within the same component
	let name = base;
	let n = 2;
	while (usedNames.has(name)) {
		name = `${base}-${n++}`;
	}
	return name;
}

/**
 * Extract `{expression}suffix` patterns from CSS declaration values
 * and replace with `var(--readable-name)`.
 *
 * Runs as a text pre-pass before PostCSS parsing, since `{expr}` is
 * invalid CSS that PostCSS can't parse. Only replaces inside property
 * values (after `:` within rule bodies), never in selectors or at-rule
 * prelude — tracked via brace-depth counting.
 *
 * Naming: simple identifier `{color}` → `--color`, camelCase `{accentColor}` → `--accent-color`,
 * complex expressions `{size / 2}` → `--size-<hash>`.
 */
export function extractCSSVars(css: string, hash: string): { css: string; cssVars: CSSVar[] } {
	const cssVars: CSSVar[] = [];
	/** Dedup: map "expr\0suffix" → existing varName so identical expressions share one CSS var */
	const seen = new Map<string, string>();
	/** Track used names to avoid collisions within a component */
	const usedNames = new Set<string>();
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
				varName = cssVarName(expr, usedNames);
				usedNames.add(varName);
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
export function rewriteScopedCSS(css: string, hash: string): string {
	const attr = `[${SCOPE_ATTR}~="${hash}"]`;
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

	let result = root.toString();
	if (result.length > 0 && !result.endsWith('\n')) result += '\n';
	return result;
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
						newNodes.push(attrSelector(attr));
						newNodes.push(lastBefore.clone());
					} else {
						newNodes.push(...before.map(n => n.clone()));
						newNodes.push(attrSelector(attr));
					}
				} else {
					newNodes.push(attrSelector(attr));
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

		const attrNode = attrSelector(attr);

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

/** Create an attribute selector node like `[data-comp~="hash"]` */
function attrSelector(attrStr: string): selectorParser.Attribute {
	// Parse the attr string like `[data-comp~="hash"]`
	const m = attrStr.match(/^\[([\w-]+)([~|^$*]?=)"([^"]+)"\]$/);
	if (!m) throw new Error(`Invalid attr selector: ${attrStr}`);
	return selectorParser.attribute({
		attribute: m[1],
		operator: m[2] as selectorParser.AttributeOptions['operator'],
		value: m[3],
		quoteMark: '"',
		raws: { value: `"${m[3]}"` },
	});
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
