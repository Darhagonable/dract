// ── Re-exports from reactivity ─────────────────────────────────────

export { state, set, prop, type Signal, type Subscriber, setSubscriber, getSubscriber, scheduleEffect, getFlushPromise } from './reactivity/state';
export { derived, getDerived, type DerivedSignal } from './reactivity/derived';
export { effect } from './reactivity/effect';

// ── Re-exports from jsx ────────────────────────────────────────────

export { jsx, Fragment } from './jsx';
export { if_block } from './blocks/if';
export { for_block } from './blocks/for';
export { switch_block, type SwitchCase } from './blocks/switch';
export { try_block } from './blocks/try';

// ── Imports needed internally ──────────────────────────────────────

import { state, set, prop, get as signalGet, type Signal, scheduleEffect, getFlushPromise } from './reactivity/state';
import { derived, getDerived, type DerivedSignal } from './reactivity/derived';
import { effect } from './reactivity/effect';
import { jsx, Fragment } from './jsx';
import { if_block } from './blocks/if';
import { for_block } from './blocks/for';
import { switch_block } from './blocks/switch';
import { try_block } from './blocks/try';

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

export function get<T>(sig: Signal<T> | DerivedSignal<T> | T): T {
    if (!sig || typeof sig !== 'object' || !('v' in (sig as any))) {
        return sig as T;
    }
    if ('fn' in (sig as any)) {
        return getDerived(sig as DerivedSignal<T>);
    }
    return signalGet(sig as Signal<T>);
}

// ── Default export ─────────────────────────────────────────────────

export default {
    state,
    get,
    set,
    prop,
    derived,
    effect,
    jsx,
    Fragment,
    if: if_block,
    for: for_block,
    switch: switch_block,
    try: try_block,
    scheduleEffect,
    getFlushPromise,
};
