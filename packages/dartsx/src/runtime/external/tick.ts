import { getFlushPromise } from '../internal/client/reactivity/state';

/**
 * Returns a promise that resolves after pending state changes are flushed.
 * If no changes are pending, resolves in the next microtask.
 */
export function tick(): Promise<void> {
    return getFlushPromise() || Promise.resolve();
}
