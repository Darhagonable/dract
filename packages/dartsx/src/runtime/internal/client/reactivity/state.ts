// ── Reactive context tracking ──────────────────────────────────────

/** The currently-running reactive subscriber (effect or derived). */
let currentSubscriber: Subscriber | null = null;

export interface Signal<T = any> {
    /** Current value */
    v: T;
    /** Version counter — bumped on every set */
    version: number;
    /** Subscribers that depend on this signal */
    subs: Set<Subscriber>;
}

export interface Subscriber {
    /** Callback to execute / re-evaluate */
    run(): void;
    /** Signals this subscriber reads from */
    deps: Set<Signal>;
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

// ── $.state(initialValue) ──────────────────────────────────────────

export function state<T>(initialValue: T): Signal<T> {
    return { v: initialValue, version: 0, subs: new Set() };
}

// ── $.get(signal) ──────────────────────────────────────────────────

export function get<T>(signal: Signal<T> | T): T {
    // Passthrough for non-signal values (enables implicit reactive mode)
    if (!signal || typeof signal !== 'object' || !('v' in (signal as any))) {
        return signal as T;
    }
    const sig = signal as Signal<T>;
    // If we're inside a reactive context, track this read.
    if (currentSubscriber) {
        sig.subs.add(currentSubscriber);
        currentSubscriber.deps.add(sig);
    }
    return sig.v;
}

// ── $.set(signal, value) ───────────────────────────────────────────

export function set<T>(signal: Signal<T> | T, value: T): T {
    // Passthrough for non-signal values (enables implicit reactive mode)
    if (!signal || typeof signal !== 'object' || !('v' in (signal as any))) {
        return value;
    }
    const sig = signal as Signal<T>;
    if (Object.is(sig.v, value)) return value;
    sig.v = value;
    sig.version++;
    // Synchronously propagate dirty flags through the entire dependency graph
    notifySubscribers(sig.subs);
    return value;
}

function notifySubscribers(subs: Set<Subscriber>): void {
    for (const sub of subs) {
        if (sub.dirty) continue; // Already dirty — skip to avoid cycles
        sub.dirty = true;

        // If this subscriber is also a signal (derived), propagate to its own subscribers
        const asDerived = sub as any;
        if (asDerived.subs && asDerived.subs.size > 0) {
            notifySubscribers(asDerived.subs);
        }

        // Schedule for execution
        scheduleEffect(sub);
    }
}

// ── $.prop(propsObj, key, defaultValue?) — read-only prop ──────────
// ── $.prop.bind(propsObj, key, defaultValue?) — two-way bindable prop

import { derived, type DerivedSignal } from './derived';

export interface PropFunction {
    <T>(propsObj: Record<string, any>, key: string, defaultValue?: T): DerivedSignal<T>;
    bind<T>(propsObj: Record<string, any>, key: string, defaultValue?: T): Signal<T> | DerivedSignal<T>;
}

function resolveProp<T>(propsObj: Record<string, any>, key: string, defaultValue?: T): DerivedSignal<T> {
    return derived(() => {
        const getter = propsObj[key];
        const val = typeof getter === 'function' ? getter() : getter;
        return val === undefined && defaultValue !== undefined ? defaultValue! : val;
    });
}

let prop: PropFunction

prop = function prop<T>(propsObj: Record<string, any>, key: string, defaultValue?: T): DerivedSignal<T> {
    return resolveProp(propsObj, key, defaultValue);
}

prop.bind = function bindProp<T>(propsObj: Record<string, any>, key: string, defaultValue?: T): Signal<T> | DerivedSignal<T> {
    const value = propsObj[key];
    if (value && typeof value === 'object' && 'v' in value) {
        return value as Signal<T>;
    }
    return resolveProp(propsObj, key, defaultValue);
};

export { prop };

// ── Effect scheduling (batched microtask) ──────────────────────────

let pendingEffects: Subscriber[] = [];
let flushScheduled = false;
let flushPromise: Promise<void> | null = null;

export function scheduleEffect(sub: Subscriber): void {
    if (pendingEffects.includes(sub)) return;
    pendingEffects.push(sub);
    if (!flushScheduled) {
        flushScheduled = true;
        flushPromise = Promise.resolve().then(flushEffects);
    }
}

function flushEffects(): void {
    flushScheduled = false;
    const effects = pendingEffects;
    pendingEffects = [];
    for (const effect of effects) {
        if (effect.dirty) {
            effect.dirty = false;
            effect.run();
        }
    }
    flushPromise = null;
}

export function getFlushPromise(): Promise<void> | null {
    return flushPromise;
}
