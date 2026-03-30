import { effect } from '../reactivity/effect';
import type { Getter, Setter } from './types';

export function bindSelectValue(element: HTMLSelectElement, get: Getter, set: Setter): void {
    element.addEventListener('change', () => {
        if (element.multiple) {
            const selected: any[] = [];
            for (const opt of element.selectedOptions) {
                selected.push((opt as any).__value ?? opt.value);
            }
            set(selected as any);
        } else {
            const opt = element.selectedOptions[0];
            set(opt ? ((opt as any).__value ?? opt.value) : undefined as any);
        }
    });

    effect(() => {
        const val = get();
        if (element.multiple) {
            const arr = Array.isArray(val) ? val : [];
            for (const opt of element.options) {
                opt.selected = arr.includes((opt as any).__value ?? opt.value);
            }
        } else {
            for (const opt of element.options) {
                if (((opt as any).__value ?? opt.value) === val) {
                    opt.selected = true;
                    break;
                }
            }
        }
    });
}
