// ── Reactive context tracking ──────────────────────────────────────

import { proxy, STATE_SYMBOL } from './proxy';
import { getDerived, isDerived, type Derived } from './derived';
import { scheduleEffect } from './scheduler';

export { scheduleEffect, getFlushPromise } from './scheduler';

/** The currently-running reactive subscriber (effect or derived). */
let currentSubscriber: Subscriber | null = null;

/** Brand symbol to identify Signal objects */
export const SIGNAL: unique symbol = Symbol('signal');

/** Symbol to mark a setter on a derived used as a bind signal */
export const SETTER: unique symbol = Symbol('setter');

export interface State<T = any> {
    /** Current value */
    v: T;
    /** Version counter — bumped on every set */
    version: number;
    /** Subscribers that depend on this signal */
    subs: Set<Subscriber>;
    /** Brand — always `true` on Signal objects */
    readonly [SIGNAL]: true;
    /** Optional bind setter (present on bind-derived signals) */
    [SETTER]?: (value: T) => void;
}

/** A Signal is either a State or a Derived */
export type Signal<T = any> = State<T> | Derived<T>;

export interface Subscriber {
    /** Callback to execute / re-evaluate */
    run(): void;
    /** Signals this subscriber reads from */
    deps: Set<State>;
    /** For derived: marks whether the cached value may be stale */
    dirty: boolean;
}

// ── Public helpers used by the rest of the runtime ─────────────────

export function getSubscriber(): Subscriber | null {
    return currentSubscriber;
}

export function setSubscriber(s: Subscriber | null): Subscriber | null {
    const prev = currentSubscriber;
    currentSubscriber = s;
    return prev;
}

// ── Type guard ─────────────────────────────────────────────────────

export function isSignal<T>(value: Signal<T> | T): value is Signal<T> {
    return !!value && typeof value === 'object' && SIGNAL in value;
}

export function isState<T>(value: Signal<T> | T): value is State<T> {
    return isSignal(value) && !('fn' in value);
}

// ── $.state(initialValue) ──────────────────────────────────────────
//
// Primitives → State (use get/set to read/write)
// Objects    → Proxy  (property access is reactive)

export function state<T extends object>(initialValue: T): T;
export function state<T>(initialValue: T): State<T>;
export function state<T>(initialValue: T): T | State<T> {
    if (typeof initialValue === 'object' && initialValue !== null) {
        // Already proxied → wrap in State (reassignable object pattern)
        if (STATE_SYMBOL in (initialValue)) {
            return { v: initialValue, version: 0, subs: new Set(), [SIGNAL]: true };
        }
        return proxy(initialValue);
    }
    return { v: initialValue, version: 0, subs: new Set(), [SIGNAL]: true };
}

// ── $.get(signal) ──────────────────────────────────────────────────

export function get<T>(signal: Signal<T> | T): T {
    // Passthrough for non-signal values
    if (!isSignal(signal)) return signal;

    // Derived — use getDerived for lazy evaluation
    if (isDerived(signal)) {
        return getDerived(signal);
    }
    // If we're inside a reactive context, track this read.
    if (currentSubscriber) {
        signal.subs.add(currentSubscriber);
        currentSubscriber.deps.add(signal);
    }
    return signal.v;
}

// ── $.set(signal, value) ───────────────────────────────────────────

export function set<T>(signal: Signal<T> | T, value: T): T {
    // Passthrough for non-signal values
    if (!isSignal(signal)) return value;

    // Bind-derived with custom setter: delegate to parent's setter
    if (signal[SETTER]) {
        signal[SETTER](value);
        return value;
    }
    // Auto-proxy object values being stored in a signal (for reassignable objects)
    const stored = (typeof value === 'object' && value !== null) ? proxy(value) : value;
    if (Object.is(signal.v, stored)) return value;
    signal.v = stored;
    notify(signal);
    return value;
}

// ── Notification ───────────────────────────────────────────────────

export function notify(signal: State): void {
    signal.version++;
    notifySubs(signal.subs);
}

function notifySubs(subs: Set<Subscriber>): void {
    for (const sub of subs) {
        if (sub.dirty) continue;
        sub.dirty = true;

        if (isDerived(sub)) {
            // Derived: just propagate dirty downstream (value is lazy — recomputed on read)
            notifySubs(sub.subs);
        } else {
            // Effect: schedule for execution in next microtask
            scheduleEffect(sub);
        }
    }
}
