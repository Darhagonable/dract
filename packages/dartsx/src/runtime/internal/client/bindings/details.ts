import { effect } from '../reactivity/effect';
import type { Getter, Setter } from './types';

export function bindOpen(element: HTMLDetailsElement, get: Getter<boolean>, set: Setter<boolean>): void {
    element.addEventListener('toggle', () => {
        set(element.open);
    });

    effect(() => {
        element.open = !!get();
    });
}
