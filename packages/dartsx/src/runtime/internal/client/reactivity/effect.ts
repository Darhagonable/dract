import { type Subscriber, setSubscriber } from './state';
import { getCurrentComponent } from '../context';

// ── Types ──────────────────────────────────────────────────────────

export interface Effect extends Subscriber {
	parent: Effect | null;
	firstChild: Effect | null;
	lastChild: Effect | null;
	prev: Effect | null;
	next: Effect | null;
}

// ── Effect tree tracking ───────────────────────────────────────────

/** The currently executing effect (for establishing parent-child tree links) */
let activeEffect: Effect | null = null;
let effectCollector: Effect[] | null = null;

// ── effect — granular render effect that re-runs on dependency changes ─

export function effect(fn: () => void): void {
	const parent = activeEffect;
	const sub: Effect = {
		run() {
			if (sub.disposed) return;
			// Clear old deps
			for (const dep of sub.deps) {
				dep.subs.delete(sub);
			}
			sub.deps.clear();
			// Re-run with tracking
			const prev = setSubscriber(sub);
			const prevActive = activeEffect;
			activeEffect = sub;
			fn();
			activeEffect = prevActive;
			setSubscriber(prev);
			sub.dirty = false;
		},
		deps: new Set(),
		dirty: true,
		parent,
		firstChild: null,
		lastChild: null,
		prev: null,
		next: null,
	};

	// Link into parent's child list
	if (parent) {
		sub.prev = parent.lastChild;
		if (parent.lastChild) {
			parent.lastChild.next = sub;
		} else {
			parent.firstChild = sub;
		}
		parent.lastChild = sub;
	}

	// Register with collector if active
	if (effectCollector) {
		effectCollector.push(sub);
	}

	// Initial execution
	sub.run();
}

/**
 * Run a function and collect all effects created during its execution (direct children only).
 */
export function collectEffects<T>(fn: () => T): { value: T; effects: Effect[] } {
	const prev = effectCollector;
	const effects: Effect[] = [];
	effectCollector = effects;
	const value = fn();
	effectCollector = prev;
	return { value, effects };
}

/**
 * Dispose effects and recursively dispose all their descendants in the effect tree.
 */
export function disposeEffects(effects: Effect[]): void {
	for (const sub of effects) {
		disposeEffect(sub);
	}
}

function disposeEffect(sub: Effect): void {
	if (sub.disposed) return;
	sub.disposed = true;

	// Recursively dispose all children in the tree
	let child = sub.firstChild;
	while (child !== null) {
		const next = child.next;
		disposeEffect(child);
		child = next;
	}
	sub.firstChild = null;
	sub.lastChild = null;

	// Unsubscribe from all dependencies
	for (const dep of sub.deps) {
		dep.subs.delete(sub);
	}
	sub.deps.clear();

	// Unlink from parent's child list
	if (sub.parent) {
		if (sub.prev) sub.prev.next = sub.next;
		else sub.parent.firstChild = sub.next;
		if (sub.next) sub.next.prev = sub.prev;
		else sub.parent.lastChild = sub.prev;
		sub.prev = null;
		sub.next = null;
		sub.parent = null;
	}
}

/**
 * Internal teardown — registers a cleanup function on the current component.
 * Used by internal binding/runtime code instead of the user-facing onCleanup.
 */
export function teardown(fn: () => void): void {
	const ctx = getCurrentComponent();
	if (ctx) {
		ctx.cleanupCallbacks.push(fn);
	}
}
