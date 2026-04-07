import type { Subscriber } from './state';

// ── Effect scheduling (batched microtask) ──────────────────────────

let pendingEffects = new Set<Subscriber>();
let flushScheduled = false;
let flushPromise: Promise<void> | null = null;

export function scheduleEffect(sub: Subscriber): void {
	pendingEffects.add(sub);
	if (!flushScheduled) {
		flushScheduled = true;
		flushPromise = Promise.resolve().then(flushEffects);
	}
}

function flushEffects(): void {
	flushScheduled = false;
	// Drain loop: effects may schedule more effects (e.g. bridge subs)
	while (pendingEffects.size > 0) {
		const effects = pendingEffects;
		pendingEffects = new Set();
		for (const effect of effects) {
			if (effect.dirty) {
				effect.dirty = false;
				effect.run();
			}
		}
	}
	flushPromise = null;
}

export function getFlushPromise(): Promise<void> | null {
	return flushPromise;
}
