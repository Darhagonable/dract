import { effect } from '../reactivity/effect';

export function bindOpen(element: HTMLDetailsElement, get: () => boolean | undefined, set: (open: boolean) => void) {
    element.addEventListener('toggle', () => {
        set(element.open);
    });

    effect(() => {
        element.open = !!get();
    });
}
