import { type Signal, get, set } from '../reactivity/state';
import { effect } from '../reactivity/effect';

// ── bind:value ─────────────────────────────────────────────────────

export function bindValue(element: HTMLInputElement | HTMLTextAreaElement, signal: Signal): void {
    element.addEventListener('input', () => {
        const type = element.type;
        if (type === 'number' || type === 'range') {
            const num = (element as HTMLInputElement).valueAsNumber;
            set(signal, Number.isNaN(num) ? undefined as any : num);
        } else {
            set(signal, element.value as any);
        }
    });

    effect(() => {
        element.value = get(signal) ?? '';
    });
}

// ── bind:checked ───────────────────────────────────────────────────

export function bindChecked(element: HTMLInputElement, signal: Signal<boolean>): void {
    element.addEventListener('change', () => {
        set(signal, element.checked);
    });

    effect(() => {
        element.checked = !!get(signal);
    });
}

// ── bind:indeterminate ─────────────────────────────────────────────

export function bindIndeterminate(element: HTMLInputElement, signal: Signal<boolean>): void {
    element.addEventListener('change', () => {
        set(signal, element.indeterminate);
    });

    effect(() => {
        element.indeterminate = !!get(signal);
    });
}

// ── bind:group ─────────────────────────────────────────────────────

export function bindGroup(element: HTMLInputElement, signal: Signal): void {
    element.addEventListener('change', () => {
        if (element.type === 'radio') {
            set(signal, element.value);
        } else {
            // checkbox group — signal holds an array
            const arr: any[] = [...(get(signal) || [])];
            if (element.checked) {
                if (!arr.includes(element.value)) arr.push(element.value);
            } else {
                const idx = arr.indexOf(element.value);
                if (idx !== -1) arr.splice(idx, 1);
            }
            set(signal, arr);
        }
    });

    effect(() => {
        const val = get(signal);
        if (element.type === 'radio') {
            element.checked = element.value === val;
        } else {
            element.checked = Array.isArray(val) && val.includes(element.value);
        }
    });
}

// ── bind:files ─────────────────────────────────────────────────────

export function bindFiles(element: HTMLInputElement, signal: Signal<FileList | null>): void {
    element.addEventListener('change', () => {
        set(signal, element.files);
    });

    effect(() => {
        const files = get(signal);
        if (files !== undefined) {
            element.files = files;
        }
    });
}
