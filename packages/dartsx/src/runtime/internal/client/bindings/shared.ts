import { teardown } from '../reactivity/effect';

/**
 * Fires the handler once immediately (unless corresponding arg is set to `false`),
 * then listens to the given events until the component is destroyed.
 */
export function listen(target: EventTarget, events: string[], handler: (event?: Event) => void, callImmediately = true): void {
    if (callImmediately)
        handler();

    for (const name of events) {
        target.addEventListener(name, handler);
    }

    teardown(() => {
        for (var name of events) {
            target.removeEventListener(name, handler);
        }
    });
}
