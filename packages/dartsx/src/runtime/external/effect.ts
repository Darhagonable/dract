import { get, type Signal, type Subscriber } from '../internal/client/reactivity/state.js';
import { getDerived, type DerivedSignal } from '../internal/client/reactivity/derived.js';

type ReactiveValue<T> = Signal<T> | DerivedSignal<T>;

function readReactive<T>(sig: ReactiveValue<T>): T {
    if ('fn' in sig) return getDerived(sig as DerivedSignal<T>);
    return get(sig);
}

/**
 * User-facing effect with explicit dependency tracking.
 *
 * Signatures:
 * - effect(dep, (newVal, oldVal) => ...)         — single dependency
 * - effect([dep1, dep2], ([new1, old1], [new2, old2]) => ...)  — multiple deps
 */
type DepPairs<T extends unknown[]> = {
    [K in keyof T]: [T[K], T[K]];
};

export function effect<T extends unknown[]>(
    deps: [...T],
    callback: (...new_and_old: [...DepPairs<T>]) => void,
): void;
export function effect<T>(
    dep: T,
    callback: (newVal: T, oldVal: T) => void,
): void;
export function effect(
    dep: unknown | unknown[],
    callback: (...args: any[]) => void | (() => void),
): void {
    if (Array.isArray(dep)) {
        // Multiple dependencies
        const deps = dep as ReactiveValue<any>[];
        let oldVals = deps.map((d) => readReactive(d));
        let cleanup: (() => void) | void;

        const sub: Subscriber = {
            run() {
                if (cleanup) cleanup();
                const newVals = deps.map((d) => readReactive(d));
                const pairs = deps.map((_, i) => [newVals[i], oldVals[i]]);
                cleanup = callback(...pairs);
                oldVals = newVals;
                sub.dirty = false;
            },
            deps: new Set(),
            dirty: true,
        };

        for (const d of deps) {
            d.subs.add(sub);
            sub.deps.add(d as Signal);
        }

        sub.run();
    } else {
        // Single dependency
        const d = dep as ReactiveValue<any>;
        let oldVal = readReactive(d);
        let cleanup: (() => void) | void;

        const sub: Subscriber = {
            run() {
                if (cleanup) cleanup();
                const newVal = readReactive(d);
                cleanup = callback(newVal, oldVal);
                oldVal = newVal;
                sub.dirty = false;
            },
            deps: new Set(),
            dirty: true,
        };

        d.subs.add(sub);
        sub.deps.add(d as Signal);

        sub.run();
    }
}
