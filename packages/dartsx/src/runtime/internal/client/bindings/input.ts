import { effect } from '../reactivity/effect';
import type { Getter, Setter } from './types';

// ── bind:value ─────────────────────────────────────────────────────

export function bindValue(element: HTMLInputElement | HTMLTextAreaElement, get: Getter, set: Setter): void {
    element.addEventListener('input', () => {
        const type = element.type;
        if (type === 'number' || type === 'range') {
            const num = (element as HTMLInputElement).valueAsNumber;
            set(Number.isNaN(num) ? undefined : num);
        } else {
            set(element.value);
        }
    });

    effect(() => {
        element.value = get() ?? '';
    });
}

// ── bind:checked ───────────────────────────────────────────────────

export function bindChecked(element: HTMLInputElement, get: Getter<boolean>, set: Setter<boolean>): void {
    element.addEventListener('change', () => {
        set(element.checked);
    });

    effect(() => {
        element.checked = !!get();
    });
}

// ── bind:indeterminate ─────────────────────────────────────────────

export function bindIndeterminate(element: HTMLInputElement, get: Getter<boolean>, set: Setter<boolean>): void {
    element.addEventListener('change', () => {
        set(element.indeterminate);
    });

    effect(() => {
        element.indeterminate = !!get();
    });
}

// ── bind:group ─────────────────────────────────────────────────────

export function bindGroup(element: HTMLInputElement, get: Getter, set: Setter): void {
    element.addEventListener('change', () => {
        if (element.type === 'radio') {
            set(element.value);
        } else {
            const arr: any[] = [...(get() || [])];
            if (element.checked) {
                if (!arr.includes(element.value)) arr.push(element.value);
            } else {
                const idx = arr.indexOf(element.value);
                if (idx !== -1) arr.splice(idx, 1);
            }
            set(arr);
        }
    });

    effect(() => {
        const val = get();
        if (element.type === 'radio') {
            element.checked = element.value === val;
        } else {
            element.checked = Array.isArray(val) && val.includes(element.value);
        }
    });
}

// ── bind:files ─────────────────────────────────────────────────────

export function bindFiles(element: HTMLInputElement, get: Getter<FileList | null>, set: Setter<FileList | null>): void {
    element.addEventListener('change', () => {
        set(element.files);
    });

    effect(() => {
        const files = get();
        if (files !== undefined) {
            element.files = files;
        }
    });
}
