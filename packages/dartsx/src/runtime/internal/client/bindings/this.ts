import { type Signal, set } from '../reactivity/state';

export function bindThis(element: Element, signal: Signal<Element | undefined>): void {
    set(signal, element);
}
