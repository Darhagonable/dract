/**
 * Fires the handler once immediately (unless disabled), then listens to events.
 */
export function listen(target: EventTarget, events: string[], handler: () => void, callImmediately = true): void {
    if (callImmediately) handler();
    for (const name of events) {
        target.addEventListener(name, handler);
    }
}
