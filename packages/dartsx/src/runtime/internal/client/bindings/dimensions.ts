import type { Setter } from './types';

// ── Singleton ResizeObserver ───────────────────────────────────────

class ResizeObserverSingleton {
    #listeners = new WeakMap<Element, Set<(entry: ResizeObserverEntry) => void>>();
    #observer: ResizeObserver | null = null;
    #options: ResizeObserverOptions;

    constructor(options: ResizeObserverOptions) {
        this.#options = options;
    }

    observe(element: Element, listener: (entry: ResizeObserverEntry) => void): () => void {
        let listeners = this.#listeners.get(element);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(element, listeners);
        }
        listeners.add(listener);
        this.#getObserver().observe(element, this.#options);

        return () => {
            listeners!.delete(listener);
            if (listeners!.size === 0) {
                this.#listeners.delete(element);
                this.#observer?.unobserve(element);
            }
        };
    }

    #getObserver(): ResizeObserver {
        return (this.#observer ??= new ResizeObserver((entries) => {
            for (const entry of entries) {
                const listeners = this.#listeners.get(entry.target);
                if (listeners) {
                    for (const listener of listeners) listener(entry);
                }
            }
        }));
    }
}

const contentBoxObserver = new ResizeObserverSingleton({ box: 'content-box' });
const borderBoxObserver = new ResizeObserverSingleton({ box: 'border-box' });
const devicePixelObserver = new ResizeObserverSingleton({ box: 'device-pixel-content-box' });

// ── Element size bindings (clientWidth, offsetHeight, etc.) ────────

export function bindElementSize(element: Element, prop: string, _get: any, set: Setter): void {
    borderBoxObserver.observe(element, () => {
        set((element as any)[prop]);
    });
}

// ── ResizeObserver entry bindings (contentRect, etc.) ──────────────

export function bindResizeObserver(element: Element, prop: string, _get: any, set: Setter): void {
    const observer =
        prop === 'contentRect' || prop === 'contentBoxSize'
            ? contentBoxObserver
            : prop === 'borderBoxSize'
                ? borderBoxObserver
                : devicePixelObserver;

    observer.observe(element, (entry) => {
        set((entry as any)[prop]);
    });
}
