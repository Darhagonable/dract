// ── Re-exports from reactivity ─────────────────────────────────────

export { state, set, prop, type Signal, type Subscriber, setSubscriber, getSubscriber, scheduleEffect, getFlushPromise } from './reactivity/state';
export { derived, getDerived, type DerivedSignal } from './reactivity/derived';
export { effect } from './reactivity/effect';

// ── Re-exports from blocks ─────────────────────────────────────────

export { if_block } from './blocks/if';
export { for_block } from './blocks/for';
export { switch_block, type SwitchCase } from './blocks/switch';
export { try_block } from './blocks/try';

// ── Re-exports from bindings ───────────────────────────────────────

export { bindValue } from './bindings/input';

// ── Imports needed internally ──────────────────────────────────────

import { state, set, prop, get as signalGet, type Signal, scheduleEffect, getFlushPromise } from './reactivity/state';
import { derived, getDerived, type DerivedSignal } from './reactivity/derived';
import { effect } from './reactivity/effect';
import { if_block } from './blocks/if';
import { for_block } from './blocks/for';
import { switch_block } from './blocks/switch';
import { try_block } from './blocks/try';
import { bindValue } from './bindings/input';

// ── Component context (for lifecycle hooks) ────────────────────────

export interface ComponentContext {
    onMountCallbacks: (() => void | (() => void))[];
    onDestroyCallbacks: (() => void)[];
    cleanupCallbacks: (() => void)[];
}

let currentComponent: ComponentContext | null = null;

export function getCurrentComponent(): ComponentContext | null {
    return currentComponent;
}

export function setCurrentComponent(ctx: ComponentContext | null): ComponentContext | null {
    const prev = currentComponent;
    currentComponent = ctx;
    return prev;
}

// ── Unified get — works for both Signal and DerivedSignal ──────────

export function get<T>(sig: Signal<T> | DerivedSignal<T>): T {
    if ('fn' in sig) {
        return getDerived(sig as DerivedSignal<T>);
    }
    return signalGet(sig);
}

// ── Template system ────────────────────────────────────────────────

const templateCache = new Map<string, HTMLTemplateElement>();

/**
 * Creates a template factory. Calling the returned function clones the template.
 * @param html - HTML string for the template
 * @param flags - 1 = fragment (multiple root elements), 0 = single root
 */
export function template(html: string, flags: number = 0): () => Node {
    let tpl = templateCache.get(html);
    if (!tpl) {
        tpl = document.createElement('template');
        tpl.innerHTML = html;
        templateCache.set(html, tpl);
    }

    return () => {
        const clone = tpl!.content.cloneNode(true) as DocumentFragment;
        // If single root element (no fragment flag), return just the first child
        if (flags === 0) {
            return clone.firstChild!;
        }
        return clone;
    };
}

// ── Node factory ───────────────────────────────────────────────────

/**
 * Create an element from a template and run a setup function on it.
 * Returns the cloned element.
 */
export function node(tmpl: () => Node, setup: (el: Element) => void): Element {
    const el = tmpl() as Element;
    setup(el);
    return el;
}

// ── DOM traversal ──────────────────────────────────────────────────

/** Get the first child of a node */
export function firstChild(node: Node): ChildNode {
    return node.firstChild!;
}

/**
 * Get a child node. For text nodes, if `isText` is true and the child
 * doesn't exist yet, create an empty text node.
 */
export function child(node: Node, isText: boolean = false): ChildNode {
    const c = node.firstChild;
    if (c) return c;
    if (isText) {
        const text = document.createTextNode('');
        node.appendChild(text);
        return text;
    }
    return c!;
}

/**
 * Navigate to a sibling. `count` is the number of steps
 * (e.g. 2 means nextSibling.nextSibling).
 */
export function sibling(node: Node, count: number = 2): ChildNode {
    let current: Node | null = node;
    for (let i = 0; i < count; i++) {
        current = current!.nextSibling;
    }
    return current as ChildNode;
}

// ── Text updates ───────────────────────────────────────────────────

export function setText(node: Node, value: string): void {
    node.textContent = value;
}

// ── Append nodes before anchor ─────────────────────────────────────

/**
 * Insert nodes into the DOM before the anchor node.
 * The anchor is a comment marker; nodes are inserted as siblings before it.
 */
export function append(anchor: Node, ...nodes: Node[]): void {
    const parent = anchor.parentNode!;
    for (const n of nodes) {
        parent.insertBefore(n, anchor);
    }
}

// ── Event delegation ───────────────────────────────────────────────

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
            // Walk up from the target to document, invoking handlers
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

/**
 * Register a delegated event handler on an element.
 * The handler is stored as a property on the element and invoked
 * by a single root listener.
 */
export function delegated(eventType: string, element: Element, handler: (e: Event) => void): void {
    ensureDelegation(eventType);
    (element as any)[`__${eventType}`] = handler;
}

// ── Attribute / prop setting ───────────────────────────────────────

export function attr(element: Element, name: string, value: any): void {
    if (value == null || value === false) {
        element.removeAttribute(name);
    } else if (value === true) {
        element.setAttribute(name, '');
    } else {
        element.setAttribute(name, String(value));
    }
}

// ── Default export ─────────────────────────────────────────────────

export default {
    state,
    get,
    set,
    prop,
    derived,
    effect,
    template,
    node,
    firstChild,
    child,
    sibling,
    setText,
    append,
    delegated,
    attr,
    bindValue,
    if: if_block,
    for: for_block,
    switch: switch_block,
    try: try_block,
    scheduleEffect,
    getFlushPromise,
};
