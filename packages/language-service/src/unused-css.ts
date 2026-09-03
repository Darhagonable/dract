/**
 * Unused CSS selector detection for DarTsx components.
 *
 * Each <style> block is scoped to its parent JSX element's children.
 * A root-level <style> (no JSX parent) scopes to the entire file.
 */

export const DARTSX_UNUSED_CSS_CODE = 90001;

export interface StyleBlock {
	css: string;
	cssStart: number;
	isGlobal: boolean;
	scopeStart: number;
	scopeEnd: number;
}

export interface UsedSelectors {
	tags: Set<string>;
	classes: Set<string>;
	ids: Set<string>;
}

export interface CSSRule {
	selector: string;
	offset: number;
}

export interface UnusedCssWarning {
	selector: string;
	start: number;
	length: number;
	message: string;
}

/**
 * Analyze a DarTsx file and return unused CSS selector warnings.
 * This is the main entry point for testing.
 */
export function analyzeUnusedCss(content: string): UnusedCssWarning[] {
	const styleBlocks = findStyleBlocks(content);
	if (styleBlocks.length === 0) return [];

	const warnings: UnusedCssWarning[] = [];

	for (const block of styleBlocks) {
		if (block.isGlobal) continue;

		const used = collectUsedSelectors(content, block.scopeStart, block.scopeEnd);
		const rules = extractRules(block.css);

		for (const rule of rules) {
			const parts = splitSelectors(rule.selector);
			for (const part of parts) {
				const trimmed = part.trim();
				if (!trimmed || trimmed.includes(':global') || trimmed.includes(':deep')) continue;
				if (isSelectorUnused(trimmed, used)) {
					const partOffset = block.css.indexOf(trimmed, rule.offset);
					const start = block.cssStart + (partOffset >= 0 ? partOffset : rule.offset);
					warnings.push({
						selector: trimmed,
						start,
						length: trimmed.length,
						message: `Unused CSS selector "${trimmed}"`,
					});
				}
			}
		}
	}
	return warnings;
}

/**
 * Forward-scan the file to find all <style> blocks and determine
 * each one's scope — the content range of the parent JSX element.
 */
export function findStyleBlocks(content: string): StyleBlock[] {
	const blocks: StyleBlock[] = [];
	const tagStack: number[] = [];

	let i = 0;
	while (i < content.length) {
		// Skip JSX expressions when inside a JSX element
		if (content[i] === '{' && tagStack.length > 0) {
			i = skipBracedExpression(content, i);
			continue;
		}
		if (content[i] !== '<') { i++; continue; }

		// <style> or <style global>
		const sm = matchAtPos(content, i, /^<style(\s+global)?\s*>/i);
		if (sm) {
			const cssStart = i + sm[0].length;
			const closeIdx = content.indexOf('</style>', cssStart);
			if (closeIdx === -1) { i++; continue; }

			blocks.push({
				css: content.slice(cssStart, closeIdx),
				cssStart,
				isGlobal: !!sm[1],
				scopeStart: tagStack.length > 0 ? tagStack[tagStack.length - 1] : 0,
				scopeEnd: -1,
			});

			i = closeIdx + 8;
			continue;
		}

		// </tag>
		if (content[i + 1] === '/') {
			const cm = matchAtPos(content, i, /^<\/[a-zA-Z][a-zA-Z0-9.-]*\s*>/);
			if (cm) {
				const popped = tagStack.pop();
				if (popped !== undefined) {
					for (const b of blocks) {
						if (b.scopeEnd === -1 && b.scopeStart === popped) {
							b.scopeEnd = i;
						}
					}
				}
				i += cm[0].length;
				continue;
			}
		}

		// <!-- comment -->
		if (content[i + 1] === '!' && content[i + 2] === '-' && content[i + 3] === '-') {
			const end = content.indexOf('-->', i + 4);
			i = end >= 0 ? end + 3 : content.length;
			continue;
		}

		// <tag ...> or <tag .../>
		const nm = matchAtPos(content, i, /^<([a-zA-Z][a-zA-Z0-9.-]*)/);
		if (nm) {
			let j = i + nm[0].length;
			while (j < content.length) {
				if (content[j] === '>') break;
				if (content[j] === '/' && content[j + 1] === '>') break;
				if (content[j] === '"') { j = content.indexOf('"', j + 1); j = j < 0 ? content.length : j + 1; continue; }
				if (content[j] === "'") { j = content.indexOf("'", j + 1); j = j < 0 ? content.length : j + 1; continue; }
				if (content[j] === '{') { j = skipBracedExpression(content, j); continue; }
				j++;
			}

			if (j < content.length && content[j] === '/' && content[j + 1] === '>') {
				i = j + 2;
			} else if (j < content.length && content[j] === '>') {
				tagStack.push(j + 1);
				i = j + 1;
			} else {
				i = j;
			}
			continue;
		}

		i++;
	}

	for (const b of blocks) {
		if (b.scopeEnd === -1) {
			b.scopeEnd = content.length;
		}
	}

	return blocks;
}

function matchAtPos(content: string, pos: number, re: RegExp): RegExpMatchArray | null {
	return content.slice(pos).match(re);
}

export function skipBracedExpression(content: string, start: number): number {
	let depth = 1;
	let j = start + 1;
	while (j < content.length && depth > 0) {
		const c = content[j];
		if (c === '{') { depth++; }
		else if (c === '}') { depth--; if (depth === 0) return j + 1; }
		// Skip /* ... */ comments (JSX comments inside braces)
		else if (c === '/' && content[j + 1] === '*') {
			j = content.indexOf('*/', j + 2);
			j = j < 0 ? content.length : j + 2;
			continue;
		}
		// Skip // line comments
		else if (c === '/' && content[j + 1] === '/') {
			j = content.indexOf('\n', j + 2);
			j = j < 0 ? content.length : j + 1;
			continue;
		}
		else if (c === '"' || c === "'" || c === '`') {
			const quote = c;
			j++;
			while (j < content.length && content[j] !== quote) {
				if (content[j] === '\\') j++;
				if (quote === '`' && content[j] === '$' && content[j + 1] === '{') { j += 2; depth++; continue; }
				j++;
			}
		}
		j++;
	}
	return j;
}

export function collectUsedSelectors(content: string, start: number, end: number): UsedSelectors {
	let region = content.slice(start, end);
	region = region.replace(/<style[\s>][\s\S]*?<\/style>/gi, '');
	// Strip JSX comments {/* ... */} so phantom tags don't count
	region = region.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

	const tags = new Set<string>();
	const classes = new Set<string>();
	const ids = new Set<string>();

	const tagRe = /<([a-zA-Z][a-zA-Z0-9.-]*)\b/g;
	let m;
	while ((m = tagRe.exec(region)) !== null) {
		const tag = m[1].toLowerCase();
		if (tag !== 'style') tags.add(tag);
	}

	const classRe = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;
	while ((m = classRe.exec(region)) !== null) {
		const val = m[1] || m[2] || '';
		for (const cls of val.split(/\s+/)) { if (cls) classes.add(cls); }
		if (m[3]) {
			const strRe = /["']([^"']+)["']/g;
			let s;
			while ((s = strRe.exec(m[3])) !== null) {
				for (const cls of s[1].split(/\s+/)) { if (cls) classes.add(cls); }
			}
		}
	}

	const idRe = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	while ((m = idRe.exec(region)) !== null) {
		const val = m[1] || m[2] || '';
		if (val) ids.add(val);
	}

	return { tags, classes, ids };
}

export function extractRules(css: string): CSSRule[] {
	const rules: CSSRule[] = [];
	extractRulesFromBlock(css, 0, rules, false);
	return rules;
}

function extractRulesFromBlock(css: string, baseOffset: number, rules: CSSRule[], inKeyframes: boolean): void {
	let i = 0;
	while (i < css.length) {
		while (i < css.length && /\s/.test(css[i])) i++;
		if (i >= css.length) break;

		if (css[i] === '/' && css[i + 1] === '*') {
			i = css.indexOf('*/', i + 2);
			i = i === -1 ? css.length : i + 2;
			continue;
		}

		const selectorStart = i;
		let depth = 0;
		while (i < css.length && !(css[i] === '{' && depth === 0)) {
			if (css[i] === '(') depth++;
			else if (css[i] === ')') depth--;
			i++;
		}
		if (i >= css.length) break;

		const selector = css.slice(selectorStart, i).trim();
		i++;

		const bodyStart = i;
		let braceDepth = 1;
		while (i < css.length && braceDepth > 0) {
			if (css[i] === '{') braceDepth++;
			else if (css[i] === '}') braceDepth--;
			if (braceDepth > 0) i++;
		}
		const bodyEnd = i;
		i++;

		if (!selector) continue;

		if (selector.startsWith('@')) {
			if (/^@keyframes\b/.test(selector)) continue;
			if (/^@media\b|^@supports\b|^@layer\b|^@container\b/.test(selector)) {
				const body = css.slice(bodyStart, bodyEnd);
				extractRulesFromBlock(body, baseOffset + bodyStart, rules, false);
				continue;
			}
			continue;
		}

		if (inKeyframes) continue;

		rules.push({ selector, offset: baseOffset + selectorStart });
	}
}

export function splitSelectors(selector: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < selector.length; i++) {
		if (selector[i] === '(') depth++;
		else if (selector[i] === ')') depth--;
		else if (selector[i] === ',' && depth === 0) {
			parts.push(selector.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(selector.slice(start));
	return parts;
}

export function isSelectorUnused(selector: string, used: UsedSelectors): boolean {
	let s = selector.replace(/::[\w-]+/g, '');
	s = s.replace(/:(?!is\b|not\b|where\b|has\b)[\w-]+/g, '');
	s = s.replace(/\[(?:[^\[\]]|\[[^\]]*\])*\]/g, '');
	s = s.replace(/:(?:is|not|where|has)\(([^)]*)\)/g, ' $1 ');

	const classRe = /\.([a-zA-Z_][\w-]*)/g;
	let m;
	while ((m = classRe.exec(s)) !== null) {
		if (!used.classes.has(m[1])) return true;
	}

	const idRe = /#([a-zA-Z_][\w-]*)/g;
	while ((m = idRe.exec(s)) !== null) {
		if (!used.ids.has(m[1])) return true;
	}

	const tagRe = /(?:^|[\s>+~])([a-zA-Z][\w]*)/g;
	while ((m = tagRe.exec(s)) !== null) {
		const tag = m[1].toLowerCase();
		if (tag === 'not' || tag === 'is' || tag === 'where' || tag === 'has' || tag === 'global' || tag === 'deep') continue;
		if (!used.tags.has(tag)) return true;
	}

	return false;
}
