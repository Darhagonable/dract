import { teardown } from '../internal/client/reactivity/effect';
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
	teardown(fn);
}
