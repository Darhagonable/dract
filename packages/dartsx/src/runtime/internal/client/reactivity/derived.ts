import { type State, type Signal, type Subscriber, SIGNAL, getSubscriber, setSubscriber, isSignal } from './state';

export interface Derived<T = any> extends State<T>, Subscriber {
    /** The computation function */
    fn: () => T;
    /** Whether this derived has ever been evaluated */
    initialized: boolean;
}

// ── $.derived(fn) ──────────────────────────────────────────────────

export function isDerived<T>(value: Signal<T> | T): value is Derived<T> {
    return isSignal(value) && 'fn' in value;
}

export function derived<T>(fn: () => T): Derived<T> {
    const sig: Derived<T> = {
        v: undefined as T,
        version: 0,
        subs: new Set(),
        [SIGNAL]: true,
        fn,
        initialized: false,
        dirty: true,
        deps: new Set(),
        // `run` exists to satisfy the Subscriber interface.
        // Derived signals are never scheduled — notifySubs handles propagation.
        run() {
            sig.dirty = true;
        },
    };

    return sig;
}

// ── Override get for derived signals ───────────────────────────────

export function getDerived<T>(signal: Derived<T>): T {
    // If dirty, recalculate (pull)
    if (signal.dirty || !signal.initialized) {
        // Untrack old dependencies
        for (const dep of signal.deps) {
            dep.subs.delete(signal);
        }
        signal.deps.clear();

        // Evaluate with this derived as the current subscriber
        const prev = setSubscriber(signal);
        const newVal = signal.fn();
        setSubscriber(prev);

        // Only bump version if value actually changed (skip downstream updates)
        if (!signal.initialized || !Object.is(signal.v, newVal)) {
            signal.v = newVal;
            signal.version++;
        }
        signal.dirty = false;
        signal.initialized = true;
    }

    // Track this read in the outer subscriber
    const outer = getSubscriber();
    if (outer) {
        signal.subs.add(outer);
        outer.deps.add(signal);
    }

    return signal.v;
}
