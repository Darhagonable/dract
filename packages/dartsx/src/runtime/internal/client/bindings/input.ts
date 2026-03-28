import { type Signal, get, set, type Subscriber, setSubscriber } from '../reactivity/state';

/**
 * Two-way bind an input element's value to a signal.
 * - signal → input: via a render effect that keeps the DOM in sync 
 * - input → signal: via an `input` event listener
 * 
 * Handles number coercion for type="number" and type="range".
 */
export function bindValue(element: HTMLInputElement, signal: Signal): void {
    // input → signal
    element.addEventListener('input', () => {
        const type = element.type;
        if (type === 'number' || type === 'range') {
            const num = element.valueAsNumber;
            set(signal, Number.isNaN(num) ? undefined as any : num);
        } else {
            set(signal, element.value as any);
        }
    });

    // signal → input (render effect)
    const sub: Subscriber = {
        run() {
            for (const dep of sub.deps) {
                dep.subs.delete(sub);
            }
            sub.deps.clear();
            const prev = setSubscriber(sub);
            const val = get(signal);
            setSubscriber(prev);
            element.value = val ?? '';
            sub.dirty = false;
        },
        deps: new Set(),
        dirty: true,
    };
    sub.run();
}
