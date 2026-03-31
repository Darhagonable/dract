import { type Signal, type Subscriber, SIGNAL, getSubscriber, setSubscriber } from './state';

export interface DerivedSignal<T = any> extends Signal<T>, Subscriber {
    /** The computation function */
    fn: () => T;
    /** Whether this derived has ever been evaluated */
    initialized: boolean;
}

// ── $.derived(fn) ──────────────────────────────────────────────────

export function derived<T>(fn: () => T): DerivedSignal<T> {
    const sig: DerivedSignal<T> = {
        v: undefined as T,
        version: 0,
        subs: new Set(),
        [SIGNAL]: true,
        fn,
        initialized: false,
        dirty: true,
        deps: new Set(),
        // `run` is called when an upstream signal notifies us (push)
        run() {
            // Just mark dirty — the actual re-evaluation is lazy (pull on get)
            sig.dirty = true;
            // Propagate dirtiness to our own subscribers
            const subs = [...sig.subs];
            for (const sub of subs) {
                sub.dirty = true;
            }
        },
    };

    return sig;
}

// ── Override get for derived signals ───────────────────────────────

export function getDerived<T>(signal: DerivedSignal<T>): T {
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
