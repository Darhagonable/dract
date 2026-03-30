import { getCurrentComponent } from '../internal/client';
import { getCurrentEffect } from './effect';

/**
 * Registers a cleanup function.
 * - Inside an effect: runs before the effect re-runs and when the component unmounts.
 * - Inside a component (outside an effect): runs when the component unmounts.
 */
export function onCleanup(fn: () => void): void {
    const effect = getCurrentEffect();
    if (effect) {
        effect.cleanups.push(fn);
        return;
    }
    const ctx = getCurrentComponent();
    if (ctx) {
        ctx.cleanupCallbacks.push(fn);
    }
}
