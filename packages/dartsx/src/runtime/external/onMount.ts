import { getCurrentComponent } from '../internal/client';

/**
 * Schedules a callback to run after the component is mounted to the DOM.
 * Must be called during component initialization.
 */
export function onMount(fn: () => void | (() => void)): void {
	const ctx = getCurrentComponent();
	if (ctx) {
		ctx.onMountCallbacks.push(fn);
	}
}
