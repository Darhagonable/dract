/**
 * Runtime style injection for DarTsx scoped CSS.
 *
 * `$.style(id, css)` creates a `<style data-dartsx="id">` element in `<head>`
 * if one doesn't already exist. Reference-counted: multiple instances of the
 * same component share one `<style>` element.
 */

const styleRefs = new Map<string, { element: HTMLStyleElement; count: number }>();

/**
 * Inject scoped CSS into the document. Reference-counted per hash ID.
 * Call on component mount; the returned cleanup function should be called on unmount.
 */
export function style(id: string, css: string): void {
	const existing = styleRefs.get(id);
	if (existing) {
		existing.count++;
		return;
	}

	const el = document.createElement('style');
	el.setAttribute('data-dartsx', id);
	el.textContent = css;
	document.head.appendChild(el);
	styleRefs.set(id, { element: el, count: 1 });
}

/**
 * Decrement the reference count for a style ID.
 * Removes the `<style>` element when the count reaches 0.
 */
export function removeStyle(id: string): void {
	const ref = styleRefs.get(id);
	if (!ref) return;
	ref.count--;
	if (ref.count <= 0) {
		ref.element.remove();
		styleRefs.delete(id);
	}
}
