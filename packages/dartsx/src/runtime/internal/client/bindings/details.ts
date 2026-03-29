import { type Signal, get, set } from '../reactivity/state';
import { effect } from '../reactivity/effect';

export function bindOpen(element: HTMLDetailsElement, signal: Signal<boolean>): void {
    element.addEventListener('toggle', () => {
        set(signal, element.open);
    });

    effect(() => {
        element.open = !!get(signal);
    });
}
