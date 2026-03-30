import type { Setter } from './types';

export function bindThis(element: Element, _get: any, set: Setter<Element | undefined>): void {
    set(element);
}
