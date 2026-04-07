import { get, isSignal, type State, type Subscriber } from '../internal/client/reactivity/state.js';
import { isDerived } from '../internal/client/reactivity/derived.js';
import { RAW, getProxyState, getSignalTarget, isProxy } from '../internal/client/reactivity/proxy.js';
import { getCurrentComponent } from '../internal/client/index.js';

// ── Effect context (so onCleanup knows which effect is running) ────

export interface EffectContext {
	cleanups: (() => void)[];
}

let currentEffect: EffectContext | null = null;

export function getCurrentEffect(): EffectContext | null {
	return currentEffect;
}

function runCleanups(ctx: EffectContext): void {
	for (const fn of ctx.cleanups) fn();
	ctx.cleanups = [];
}

/** Resolve a dep (State, Derived, or proxy) to a State for subscription */
function resolveSignal(dep: any): State {
	// State or Derived — unwrap signalProxy to get raw signal
	if (isSignal(dep)) {
		return getSignalTarget(dep);
	}
	// Proxy → get its root state
	if (isProxy(dep)) {
		const sig = getProxyState(dep);
		if (sig) return sig;
	}
	throw new Error('effect: invalid dependency — expected a signal or proxy');
}

/** Read the current value of a dep (signal value, or the raw target for proxies) */
function readDep(dep: any) {
	if (isSignal(dep)) {
		const val = get(dep);
		// If the signal holds a proxy, return its raw target for comparison
		if (isProxy(val)) return val[RAW];
		return val;
	}
	if (isProxy(dep)) {
		return dep[RAW];
	}
	return dep;
}

/** Snapshot a dep for oldVal tracking (structuredClone for proxies so old !== new) */
function snapshotDep(dep: any) {
	if (isProxy(dep)) {
		return structuredClone(dep[RAW]);
	}
	if (isSignal(dep)) {
		const val = get(dep);
		if (isProxy(val)) return structuredClone(val[RAW]);
		return val;
	}
	return readDep(dep);
}

/**
 * User-facing effect with explicit dependency tracking.
 * Use onCleanup() inside the callback for cleanup logic.
 *
 * Signatures:
 * - effect(dep, (newVal, oldVal) => ...)            — single dependency (signal or proxy)
 * - effect([dep1, dep2], ([new1, old1], [new2, old2]) => ...)  — multiple deps
 */
type DepPairs<T extends unknown[]> = {
	[K in keyof T]: [T[K], T[K]];
};

export function effect<T extends unknown[]>(
	deps: [...T],
	callback: (...new_and_old: [...DepPairs<T>]) => void,
): void;
export function effect<T extends unknown>(
	dep: T,
	callback: (newVal: T, oldVal: T) => void,
): void;
export function effect<T extends unknown>(
	dep: T | T[],
	callback: (...args: any[]) => void,
): void {
	if (Array.isArray(dep) && !isProxy(dep)) {
		// Multiple dependencies (but not a proxied array)
		const deps = dep;
		const signals = deps.map(resolveSignal);
		let oldVals = deps.map(readDep);
		const ctx: EffectContext = { cleanups: [] };

		const sub: Subscriber = {
			run() {
				const newVals = deps.map(readDep);

				// Skip if no dep actually changed (can happen with derived chain propagation)
				if (!firstRun && newVals.every((v, i) => Object.is(v, oldVals[i]))) {
					sub.dirty = false;
					return;
				}

				runCleanups(ctx);

				const prevEffect = currentEffect;
				currentEffect = ctx;

				const pairs = deps.map((_, i) => [newVals[i], oldVals[i]]);
				callback(...pairs);

				currentEffect = prevEffect;
				oldVals = deps.map(snapshotDep);
				sub.dirty = false;
			},
			deps: new Set(),
			dirty: true,
		};

		let firstRun = true;

		for (const sig of signals) {
			sig.subs.add(sub);
			sub.deps.add(sig);
		}

		sub.run();
		firstRun = false;

		// Auto-dispose when the owning component unmounts
		const componentCtx = getCurrentComponent();
		if (componentCtx) {
			componentCtx.onDestroyCallbacks.push(() => {
				runCleanups(ctx);
				for (const sig of sub.deps) sig.subs.delete(sub);
				sub.deps.clear();
			});
		}
	} else {
		// Single dependency
		const sig = resolveSignal(dep);
		let oldVal = readDep(dep);
		const ctx: EffectContext = { cleanups: [] };

		const sub: Subscriber = {
			run() {
				const newVal = readDep(dep);

				// Skip if dep value didn't actually change (can happen with derived chain propagation)
				if (!firstRun && Object.is(newVal, oldVal)) {
					sub.dirty = false;
					return;
				}

				runCleanups(ctx);

				const prevEffect = currentEffect;
				currentEffect = ctx;

				callback(newVal, oldVal);

				currentEffect = prevEffect;
				oldVal = snapshotDep(dep);
				sub.dirty = false;
			},
			deps: new Set(),
			dirty: true,
		};

		let firstRun = true;

		sig.subs.add(sub);
		sub.deps.add(sig);

		sub.run();
		firstRun = false;

		// Auto-dispose when the owning component unmounts
		const componentCtx = getCurrentComponent();
		if (componentCtx) {
			componentCtx.onDestroyCallbacks.push(() => {
				runCleanups(ctx);
				for (const s of sub.deps) s.subs.delete(sub);
				sub.deps.clear();
			});
		}
	}
}
