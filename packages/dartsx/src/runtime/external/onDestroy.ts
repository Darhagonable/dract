import { getCurrentComponent } from '../internal/client';

/**
 * Schedules a callback to run immediately before the component is unmounted.
 * Must be called during component initialization.
 */
export function onDestroy(fn: () => void): void {
	const ctx = getCurrentComponent();
	if (ctx) {
		ctx.onDestroyCallbacks.push(fn);
	}
}
