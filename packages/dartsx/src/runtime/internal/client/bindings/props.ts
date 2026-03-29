import { type Signal, get, set } from '../reactivity/state';
import { effect } from '../reactivity/effect';

export function bindInnerHTML(element: HTMLElement, signal: Signal<string>): void {
    element.addEventListener('input', () => {
        set(signal, element.innerHTML);
    });

    effect(() => {
        const value = get(signal);
        if (element.innerHTML !== value) {
            element.innerHTML = value ?? '';
        }
    });
}

export function bindInnerText(element: HTMLElement, signal: Signal<string>): void {
    element.addEventListener('input', () => {
        set(signal, element.innerText);
    });

    effect(() => {
        const value = get(signal);
        if (element.innerText !== value) {
            element.innerText = value ?? '';
        }
    });
}

export function bindTextContent(element: HTMLElement, signal: Signal<string>): void {
    element.addEventListener('input', () => {
        set(signal, element.textContent ?? '');
    });

    effect(() => {
        const value = get(signal);
        if (element.textContent !== value) {
            element.textContent = value ?? '';
        }
    });
}

export function bindProperty(element: Element, prop: string, event: string, signal: Signal): void {
    element.addEventListener(event, () => {
        set(signal, (element as any)[prop]);
    });

    effect(() => {
        (element as any)[prop] = get(signal);
    });
}
