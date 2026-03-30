import { effect } from '../reactivity/effect';
import type { Getter, Setter } from './types';

export function bindInnerHTML(element: HTMLElement, get: Getter<string>, set: Setter<string>): void {
    element.addEventListener('input', () => {
        set(element.innerHTML);
    });

    effect(() => {
        const value = get();
        if (element.innerHTML !== value) {
            element.innerHTML = value ?? '';
        }
    });
}

export function bindInnerText(element: HTMLElement, get: Getter<string>, set: Setter<string>): void {
    element.addEventListener('input', () => {
        set(element.innerText);
    });

    effect(() => {
        const value = get();
        if (element.innerText !== value) {
            element.innerText = value ?? '';
        }
    });
}

export function bindTextContent(element: HTMLElement, get: Getter<string>, set: Setter<string>): void {
    element.addEventListener('input', () => {
        set(element.textContent ?? '');
    });

    effect(() => {
        const value = get();
        if (element.textContent !== value) {
            element.textContent = value ?? '';
        }
    });
}

export function bindProperty(element: Element, prop: string, event: string, get: Getter, set: Setter): void {
    element.addEventListener(event, () => {
        set((element as any)[prop]);
    });

    effect(() => {
        (element as any)[prop] = get();
    });
}
