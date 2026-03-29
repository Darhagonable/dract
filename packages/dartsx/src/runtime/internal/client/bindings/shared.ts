import { type Signal, get, set } from '../reactivity/state';

/**
 * Fires the handler once immediately (unless disabled), then listens to events.
 */
export function listen(target: EventTarget, events: string[], handler: () => void, callImmediately = true): void {
    if (callImmediately) handler();
    for (const name of events) {
        target.addEventListener(name, handler);
    }
}

/**
 * Shorthand: listen to event(s) and push DOM value into a signal.
 */
export function listen_and_set(target: EventTarget, events: string[], signal: Signal, getter: () => any): void {
    const handler = () => set(signal, getter());
    listen(target, events, handler);
}
