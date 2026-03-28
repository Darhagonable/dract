import { type Signal, type Subscriber, get as signalGet, getSubscriber, setSubscriber } from './state';

export interface DerivedSignal<T = any> extends Signal<T> {
    /** The computation function */
    fn: () => T;
    /** Whether this derived has ever been evaluated */
    initialized: boolean;
    /** Whether the cached value may be stale */
    dirty: boolean;
}

// ── $.derived(fn) ──────────────────────────────────────────────────

export function derived<T>(fn: () => T): DerivedSignal<T> {
    const sig: DerivedSignal<T> = {
        v: undefined as T,
        version: 0,
        subs: new Set(),
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
    } as DerivedSignal<T> & Subscriber;

    return sig;
}

// ── Override get for derived signals ───────────────────────────────

export function getDerived<T>(sig: DerivedSignal<T>): T {
    // If dirty, recalculate (pull)
    if (sig.dirty || !sig.initialized) {
        // Untrack old dependencies
        const sub = sig as unknown as Subscriber;
        for (const dep of sub.deps) {
            dep.subs.delete(sub);
        }
        sub.deps.clear();

        // Evaluate with this derived as the current subscriber
        const prev = setSubscriber(sub);
        const newVal = sig.fn();
        setSubscriber(prev);

        // Only bump version if value actually changed (skip downstream updates)
        if (!sig.initialized || !Object.is(sig.v, newVal)) {
            sig.v = newVal;
            sig.version++;
        }
        sig.dirty = false;
        sig.initialized = true;
    }

    // Track this read in the outer subscriber
    const outer = getSubscriber();
    if (outer) {
        sig.subs.add(outer);
        (outer as Subscriber).deps.add(sig as unknown as Signal);
    }

    return sig.v;
}
