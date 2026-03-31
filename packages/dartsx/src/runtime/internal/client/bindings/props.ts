import { effect } from '../reactivity/effect';

export function bindInnerHTML(element: HTMLElement, get: () => string | undefined, set: (html: string) => void) {
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

export function bindInnerText(element: HTMLElement, get: () => string | undefined, set: (text: string) => void) {
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

export function bindTextContent(element: HTMLElement, get: () => string | undefined, set: (text: string) => void) {
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

export function bindProperty(element: Element, prop: string, event: string, get: () => unknown, set: (value: unknown) => void) {
    element.addEventListener(event, () => {
        set(Reflect.get(element, prop));
    });

    effect(() => {
        Reflect.set(element, prop, get());
    });
}
