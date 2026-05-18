// ── JSX runtime ────────────────────────────────────────────────────

import clsx from 'clsx';
import { effect } from '../reactivity/effect';
import { applyBinding } from '../bindings';
import { setValueForStyles } from './style';
import { getCurrentComponent, setCurrentComponent, type ComponentContext } from '../context';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';

// ── Fragment sentinel ──────────────────────────────────────────────

export const Fragment = Symbol('Fragment');

// ── JSX factory ────────────────────────────────────────────────────

export function jsx(
	tag: string | typeof Fragment | Function,
	props?: Record<string, any> | null,
): Node {
	// Fragment — just return children in a fragment
	if (tag === Fragment) {
		const frag = document.createDocumentFragment();
		if (props?.children != null) {
			appendChildren(frag, props.children);
		}
		return frag;
	}

	// Component — call function with a new ComponentContext
	if (typeof tag === 'function') {
		const parentCtx = getCurrentComponent();
		const ctx: ComponentContext = {
			onMountCallbacks: [],
			onDestroyCallbacks: [],
			cleanupCallbacks: [],
			parent: parentCtx,
			contexts: new Map(),
		};
		const prev = setCurrentComponent(ctx);
		const result = tag(props || {});
		setCurrentComponent(prev);

		// Flush onMount callbacks
		if (ctx.onMountCallbacks.length > 0) {
			const prev2 = setCurrentComponent(ctx);
			for (const cb of ctx.onMountCallbacks) cb();
			setCurrentComponent(prev2);
		}

		if (result instanceof Node) return result;
		if (result != null && typeof result.then === 'function') return result;
		if (typeof result === 'function') {
			// Reactive component return (e.g. fragment with single reactive child)
			const frag = document.createDocumentFragment();
			appendChild(frag, result);
			return frag;
		}
		if (result == null) return document.createComment('');
		return document.createTextNode(String(result));
	}

	// Native HTML element
	return applyProps(document.createElement(tag), props);
}

// ── Namespaced element factories (called by compiler) ──────────────

export function svg(tag: string, props?: Record<string, any> | null): Element {
	return applyProps(document.createElementNS(SVG_NS, tag), props);
}

export function math(tag: string, props?: Record<string, any> | null): Element {
	return applyProps(document.createElementNS(MATH_NS, tag), props);
}

/**
 * Merge multiple prop sources preserving getters (reactivity).
 * Used when JSX has spread attributes: <input {...props} class="x" />
 */
export function mergeProps(...sources: Record<string, any>[]): Record<string, any> {
	const target = {};
	for (const source of sources) {
		Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
	}
	return target;
}

function applyProps<T extends Element & { style: CSSStyleDeclaration }>(el: T, props?: Record<string, any> | null): T {
	if (props) {
		const descriptors = Object.getOwnPropertyDescriptors(props);
		for (const key in descriptors) {
			if (key === 'children') continue;
			const desc = descriptors[key];
			if (desc.get && desc.set) {
				// Two-way binding (getter + setter)
				applyBinding(el, key, desc.get, desc.set);
			} else if (desc.set && !desc.get) {
				// Write-only binding (e.g. bind:clientWidth with null getter)
				applyBinding(el, key, null, desc.set);
			} else if (desc.get) {
				// Reactive prop (getter only) — set up an effect
				const getter = desc.get;
				if (key === 'style') {
					let prevStyles: Record<string, any> | null = null;
					effect(() => {
						const nextStyles = getter();
						if (typeof nextStyles === 'object' && nextStyles !== null && !Array.isArray(nextStyles)) {
							setValueForStyles(el as any, nextStyles, prevStyles);
							prevStyles = nextStyles;
						}
					});
				} else {
					effect(() => applyProp(el, key, getter()));
				}
			} else {
				applyProp(el, key, desc.value);
			}
		}
		if (props.children != null) {
			appendChildren(el, props.children);
		}
	}
	return el;
}

// ── Prop application ───────────────────────────────────────────────

function applyProp(el: Element & { style: CSSStyleDeclaration }, key: string, value: any): void {
	setAttribute(el, key, value);
}

function setAttribute(el: Element & { style: CSSStyleDeclaration }, name: string, value: any): void {
	// Function values → property assignment (handles onclick, onmouseover, etc. naturally)
	if (typeof value === 'function') {
		(el as Record<string, any>)[name] = value;
		return;
	}

	// innerHTML / textContent / innerText are DOM properties
	if (name === 'innerHTML' || name === 'textContent' || name === 'innerText') {
		(el as HTMLElement)[name] = value ?? '';
		return;
	}

	// Store raw (possibly non-string) value on options/selects as __value
	if (name === 'value' && (el.tagName === 'OPTION' || el.tagName === 'SELECT')) {
		(el as any).__value = value;
		if (value == null) {
			el.removeAttribute(name);
		} else {
			el.setAttribute(name, String(value));
		}
		return;
	}

	// class: support objects, arrays, and strings via clsx
	if (name === 'class') {
		const classValue = typeof value === 'string' ? value : clsx(value);
		if (classValue) {
			el.setAttribute('class', classValue);
		} else {
			el.removeAttribute('class');
		}
		return;
	}

	// style: support objects with camelCase properties
	if (name === 'style' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
		setValueForStyles(el as HTMLElement, value);
		return;
	}

	if (value == null || value === false) {
		el.removeAttribute(name);
	} else if (value === true) {
		el.setAttribute(name, '');
	} else {
		el.setAttribute(name, String(value));
	}
}

// ── Children processing ────────────────────────────────────────────

function appendChildren(parent: Node, children: any): void {
	if (children == null) return;
	if (!Array.isArray(children)) {
		appendChild(parent, children);
		return;
	}
	for (const child of children) {
		appendChild(parent, child);
	}
}

export function appendChild(parent: Node, child: any): void {
	if (child == null || child === false || child === true) return;

	if (child instanceof Node) {
		parent.appendChild(child);
		return;
	}

	if (Array.isArray(child)) {
		appendChildren(parent, child);
		return;
	}

	if (typeof child === 'function') {
		// Reactive child — anchor + effect
		const anchor = document.createComment('');
		parent.appendChild(anchor);
		let currentNodes: Node[] = [];

		effect(() => {
			const val = child();

			// Remove old
			for (const n of currentNodes) n.parentNode?.removeChild(n);
			currentNodes = [];

			if (val == null || val === false || val === true) return;

			if (val instanceof Node) {
				// For DocumentFragment, collect children before inserting
				if (val instanceof DocumentFragment) {
					const nodes = Array.from(val.childNodes);
					for (const n of nodes) {
						anchor.parentNode!.insertBefore(n, anchor);
						currentNodes.push(n);
					}
				} else {
					anchor.parentNode!.insertBefore(val, anchor);
					currentNodes.push(val);
				}
				return;
			}

			if (Array.isArray(val)) {
				for (const item of val) {
					const node = toNode(item);
					if (node) {
						anchor.parentNode!.insertBefore(node, anchor);
						currentNodes.push(node);
					}
				}
				return;
			}

			// Primitive
			const text = document.createTextNode(String(val));
			anchor.parentNode!.insertBefore(text, anchor);
			currentNodes = [text];
		});
		return;
	}

	// Static primitive
	parent.appendChild(document.createTextNode(String(child)));
}

function toNode(value: any): Node | null {
	if (value == null || value === false || value === true) return null;
	if (value instanceof Node) return value;
	if (Array.isArray(value)) {
		const frag = document.createDocumentFragment();
		for (const item of value) {
			const node = toNode(item);
			if (node) frag.appendChild(node);
		}
		return frag.childNodes.length > 0 ? frag : null;
	}
	if (typeof value === 'function') return toNode(value());
	return document.createTextNode(String(value));
}
