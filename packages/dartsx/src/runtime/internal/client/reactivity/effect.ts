import { type Subscriber, setSubscriber } from './state';
import { getCurrentComponent } from '../context';

// ── effect — granular render effect that re-runs on dependency changes ─

export function effect(fn: () => void): void {
    const sub: Subscriber = {
        run() {
            // Clear old deps
            for (const dep of sub.deps) {
                dep.subs.delete(sub);
            }
            sub.deps.clear();
            // Re-run with tracking
            const prev = setSubscriber(sub);
            fn();
            setSubscriber(prev);
            sub.dirty = false;
        },
        deps: new Set(),
        dirty: true,
    };

    // Initial execution
    sub.run();
}

/**
 * Internal teardown — registers a cleanup function on the current component.
 * Used by internal binding/runtime code instead of the user-facing onCleanup.
 */
export function teardown(fn: () => void): void {
    const ctx = getCurrentComponent();
    if (ctx) {
        ctx.cleanupCallbacks.push(fn);
    }
}