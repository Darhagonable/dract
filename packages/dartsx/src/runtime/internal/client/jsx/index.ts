// ── JSX runtime ────────────────────────────────────────────────────

import { effect } from '../reactivity/effect';
import { applyBinding } from '../bindings';

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

    // Component — call function, get DOM back
    if (typeof tag === 'function') {
        const result = tag(props || {});
        if (result instanceof Node) return result;
        if (result == null) return document.createComment('');
        return document.createTextNode(String(result));
    }

    // Native element
    const el = document.createElement(tag);

    if (props) {
        for (const key of Object.keys(props)) {
            if (key === 'children') continue;
            applyProp(el, key, props[key]);
        }
        if (props.children != null) {
            appendChildren(el, props.children);
        }
    }

    return el;
}

// ── Prop application ───────────────────────────────────────────────

const DELEGATED_EVENTS = new Set([
    'beforeinput', 'click', 'change', 'dblclick', 'contextmenu',
    'focusin', 'focusout', 'input', 'keydown', 'keyup',
    'mousedown', 'mousemove', 'mouseout', 'mouseover', 'mouseup',
    'pointerdown', 'pointermove', 'pointerout', 'pointerover', 'pointerup',
    'touchend', 'touchmove', 'touchstart',
]);

const registeredDelegations = new Set<string>();

function ensureDelegation(eventType: string): void {
    if (registeredDelegations.has(eventType)) return;
    registeredDelegations.add(eventType);

    const passive = eventType === 'touchstart' || eventType === 'touchmove';

    document.addEventListener(
        eventType,
        (event: Event) => {
            let node = event.target as Node | null;
            while (node) {
                const handler = (node as any)[`__${eventType}`];
                if (handler) {
                    handler.call(node, event);
                    if (event.cancelBubble) return;
                }
                node = node.parentNode;
            }
        },
        passive ? { passive: true } : undefined,
    );
}

function applyProp(el: Element, key: string, value: any): void {
    // Event handler: onclick, onkeydown, etc.
    if (key.startsWith('on') && key.length > 2) {
        const eventName = key.slice(2).toLowerCase();
        if (DELEGATED_EVENTS.has(eventName)) {
            ensureDelegation(eventName);
            (el as any)[`__${eventName}`] = value;
        } else {
            el.addEventListener(eventName, value);
        }
        return;
    }

    // Two-way binding: bind:value, bind:checked, etc.
    if (key.startsWith('bind:')) {
        applyBinding(el, key.slice(5), value);
        return;
    }

    // Dynamic attribute (function → reactive)
    if (typeof value === 'function') {
        effect(() => {
            setAttribute(el, key, value());
        });
        return;
    }

    // Static attribute
    setAttribute(el, key, value);
}

function setAttribute(el: Element, name: string, value: any): void {
    // Store raw (possibly non-string) value on options/selects as __value
    if (name === 'value' && (el.tagName === 'OPTION' || el.tagName === 'SELECT')) {
        (el as any).__value = value;
        // For <option>, also set the DOM value attribute as string
        if (value == null) {
            el.removeAttribute(name);
        } else {
            el.setAttribute(name, String(value));
        }
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

function appendChild(parent: Node, child: any): void {
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
            for (const n of currentNodes) n.remove();
            currentNodes = [];

            if (val == null || val === false || val === true) return;

            if (val instanceof Node) {
                // For DocumentFragment, collect children before inserting
                if (val instanceof DocumentFragment) {
                    const nodes: Node[] = [];
                    while (val.firstChild) nodes.push(val.firstChild);
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
    return document.createTextNode(String(value));
}
