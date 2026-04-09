import { effect } from '../../client/reactivity/effect';
import { teardown } from '../../client/reactivity/effect';

/**
 * Set CSS custom properties on the specific elements that use them.
 * Each group maps a scoped CSS selector to its reactive var getters.
 *
 * - Uses querySelectorAll to target only the relevant elements
 * - MutationObserver re-applies vars when new elements are added (e.g. control flow)
 * - Cleanup is registered on the component context for proper teardown
 */
export function cssVars(
	rootNode: Element | DocumentFragment,
	groups: [string, Record<string, () => string | number>][],
): void {
	// Cache latest values for MutationObserver re-application
	const cache = new Map<string, string>();

	function applyVar(selector: string, name: string, value: string): void {
		const key = `${selector}\0${name}`;
		cache.set(key, value);
		applyToMatches(rootNode, selector, name, value);
	}

	// Set up reactive effects — one per var for fine-grained updates
	for (const [selector, vars] of groups) {
		for (const [name, getter] of Object.entries(vars)) {
			effect(() => {
				applyVar(selector, name, String(getter()));
			});
		}
	}

	// MutationObserver: re-apply cached values when DOM structure changes
	// (handles elements added by control flow like if/for blocks)
	const scope = rootNode instanceof HTMLElement ? rootNode : rootNode.firstElementChild;
	if (scope) {
		const observer = new MutationObserver(() => {
			for (const [key, value] of cache) {
				const idx = key.indexOf('\0');
				const selector = key.slice(0, idx);
				const name = key.slice(idx + 1);
				applyToMatches(rootNode, selector, name, value);
			}
		});
		observer.observe(scope, { childList: true, subtree: true });
		teardown(() => observer.disconnect());
	}
}

/** Apply a single CSS custom property to all elements matching a scoped selector. */
function applyToMatches(
	root: Element | DocumentFragment,
	selector: string,
	name: string,
	value: string,
): void {
	if (!selector) {
		// No selector — fall back to root element(s)
		if (root instanceof HTMLElement) {
			root.style.setProperty(name, value);
		} else {
			for (const child of root.childNodes) {
				if (child instanceof HTMLElement) {
					child.style.setProperty(name, value);
				}
			}
		}
		return;
	}

	// Query matching descendants + root
	const matched = new Set<Element>();
	const targets = root.querySelectorAll(selector);
	for (const el of targets) matched.add(el);
	if (root instanceof HTMLElement) {
		try { if (root.matches(selector)) matched.add(root); } catch (_e) { /* invalid selector */ }
	}

	// CSS custom properties inherit — only set on the topmost matching elements.
	// Skip any element whose ancestor is also in the matched set.
	for (const el of matched) {
		if (el instanceof HTMLElement) {
			let dominated = false;
			let parent = el.parentElement;
			while (parent) {
				if (matched.has(parent)) { dominated = true; break; }
				// Stop at root boundary — don't walk outside the scope
				if (parent === (root instanceof HTMLElement ? root.parentElement : null)) break;
				parent = parent.parentElement;
			}
			if (!dominated) {
				el.style.setProperty(name, value);
			}
		}
	}
}
