import { teardown } from '../reactivity/effect';

// ── Singleton ResizeObserver ───────────────────────────────────────

class ResizeObserverSingleton {
	#listeners = new WeakMap<Element, Set<(entry: ResizeObserverEntry) => void>>();
	#observer: ResizeObserver | undefined;
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

export function bindElementSize(element: HTMLElement, prop: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight' | 'scrollWidth' | 'scrollHeight', set: (size: number) => void) {
	const unsub = borderBoxObserver.observe(element, () => {
		set(element[prop]);
	});
	teardown(unsub);
}

// ── ResizeObserver entry bindings (contentRect, etc.) ──────────────

export function bindResizeObserver(element: Element, prop: 'contentRect' | 'contentBoxSize' | 'borderBoxSize' | 'devicePixelContentBoxSize', set: (entry: keyof ResizeObserverEntry) => void) {
	const observer =
		prop === 'contentRect' || prop === 'contentBoxSize'
			? contentBoxObserver
			: prop === 'borderBoxSize'
				? borderBoxObserver
				: devicePixelObserver;

	const unsub = observer.observe(element, (entry) => set(entry[prop] as any));
	teardown(unsub);
}
