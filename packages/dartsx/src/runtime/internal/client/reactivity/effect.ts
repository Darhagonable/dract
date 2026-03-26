import { type Subscriber, setSubscriber } from './state.js';

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