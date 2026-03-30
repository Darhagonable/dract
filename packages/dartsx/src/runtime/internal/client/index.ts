// ── Re-exports from reactivity ─────────────────────────────────────

export { state, get, set, notify, isSignal, SIGNAL, SETTER, type Signal, type Subscriber, setSubscriber, getSubscriber } from './reactivity/state';
export { scheduleEffect, getFlushPromise } from './reactivity/scheduler';
export { prop } from './reactivity/prop';
export { derived, getDerived, type DerivedSignal } from './reactivity/derived';
export { effect } from './reactivity/effect';
export { proxy, RAW, STATE_SYMBOL, getProxySignal } from './reactivity/proxy';
export type { Getter, Setter, BindTuple } from './bindings/types';

// ── Re-exports from jsx ────────────────────────────────────────────

export { jsx, Fragment } from './jsx';
export { if_block } from './blocks/if';
export { for_block } from './blocks/for';
export { switch_block, type SwitchCase } from './blocks/switch';
export { try_block } from './blocks/try';

// ── Imports needed internally ──────────────────────────────────────

import { state, get, set } from './reactivity/state';
import { scheduleEffect, getFlushPromise } from './reactivity/scheduler';
import { prop } from './reactivity/prop';
import { derived } from './reactivity/derived';
import { effect } from './reactivity/effect';
import { proxy } from './reactivity/proxy';
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

// ── Default export ─────────────────────────────────────────────────

export default {
    state,
    get,
    set,
    prop,
    proxy,
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
