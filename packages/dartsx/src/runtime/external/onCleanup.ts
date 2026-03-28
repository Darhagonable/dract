import { getCurrentComponent, type ComponentContext } from '../internal/client';

/**
 * Registers a cleanup function in the current component scope.
 * Runs when the component is destroyed.
 */
export function onCleanup(fn: () => void): void {
    const ctx = getCurrentComponent();
    if (ctx) {
        ctx.cleanupCallbacks.push(fn);
    }
}
