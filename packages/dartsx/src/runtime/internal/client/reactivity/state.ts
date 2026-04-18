// ── Reactive context tracking ──────────────────────────────────────

import { proxy, isProxy, getSignalTarget, getProxyState, signalProxy } from './proxy';
import { getDerived, isDerived, type Derived } from './derived';
import { scheduleEffect } from './scheduler';


/** The currently-running reactive subscriber (effect or derived). */
let currentSubscriber: Subscriber | null = null;

/** Brand symbol to identify Signal objects */
export const SIGNAL: unique symbol = Symbol('signal');

/** Symbol to mark a setter on a derived used as a bind signal */
export const SETTER: unique symbol = Symbol('setter');

export interface State<T = any> {
	/** Current value */
	v: T;
	/** Version counter — bumped on every set */
	version: number;
	/** Subscribers that depend on this signal */
	subs: Set<Subscriber>;
	/** Brand — always `true` on Signal objects */
	readonly [SIGNAL]: true;
	/** Optional bind setter (present on bind-derived signals) */
	[SETTER]?: (value: T) => void;
}

/** A Signal is either a State or a Derived */
export type Signal<T = any> = State<T> | Derived<T>;

export interface Subscriber {
	/** Callback to execute / re-evaluate */
	run(): void;
	/** Signals this subscriber reads from */
	deps: Set<State>;
	/** For derived: marks whether the cached value may be stale */
	dirty: boolean;
}

// ── Public helpers used by the rest of the runtime ─────────────────

export function getSubscriber(): Subscriber | null {
	return currentSubscriber;
}

export function setSubscriber(s: Subscriber | null): Subscriber | null {
	const prev = currentSubscriber;
	currentSubscriber = s;
	return prev;
}

// ── Type guard ─────────────────────────────────────────────────────

export function isSignal<T>(value: Signal<T> | T): value is Signal<T> {
	return !!value && typeof value === 'object' && SIGNAL in value;
}

export function isState<T>(value: Signal<T> | T): value is State<T> {
	return isSignal(value) && !('fn' in value);
}

// ── $.state(initialValue) ──────────────────────────────────────────
//
// Always returns a State signal.
// Objects/arrays → signalProxy: deep access (user.name, items[0]) goes
// through the proxy; root reads use $.get(), root reassignment uses $.set().
// Primitives → plain State signal.

/**
 * Bridge a proxy's root signal to a State signal so that deep mutations
 * (e.g. user.name = 'Bob') also notify the State signal's subscribers.
 */
function bridgeProxyToSignal(proxyValue: any, sig: State): void {
	const proxySig = getProxyState(proxyValue);
	if (!proxySig) return;
	const bridge: Subscriber = {
		run() { notify(sig); },
		dirty: false,
		deps: new Set(),
	};
	proxySig.subs.add(bridge);
}

export function state<T = undefined>(): State<T | undefined>
export function state<T>(initialValue: T): State<T>
export function state<T>(initialValue?: T): State<T> {
	// Object/array: create proxy, then share subs between proxy root & State signal
	const value = (typeof initialValue === 'object' && initialValue !== null && !isProxy(initialValue))
		? proxy(initialValue)
		: initialValue;

	const sig: State<T> = { v: value as T, version: 0, subs: new Set(), [SIGNAL]: true };

	// Bridge: proxy root mutations should notify the State signal
	if (typeof value === 'object' && value !== null && isProxy(value)) {
		bridgeProxyToSignal(value, sig);
	}

	// Object/array state: wrap in signalProxy so deep access works directly
	if (typeof value === 'object' && value !== null) {
		return signalProxy(sig, (raw) => {
			// Track the read so effects/deriveds subscribe to root changes
			const sub = currentSubscriber;
			if (sub) {
				raw.subs.add(sub);
				sub.deps.add(raw);
			}
			return raw.v;
		});
	}

	return sig;
}

// ── $.get(signal) ──────────────────────────────────────────────────

export function get<T>(signal: Signal<T> | T): T {
	// Passthrough for non-signal values
	if (!isSignal(signal)) return signal;

	// Unwrap signal proxies to access the raw signal
	signal = getSignalTarget(signal);

	// Derived — use getDerived for lazy evaluation
	if (isDerived(signal)) {
		return getDerived(signal);
	}
	// If we're inside a reactive context, track this read.
	if (currentSubscriber) {
		signal.subs.add(currentSubscriber);
		currentSubscriber.deps.add(signal);
	}
	return signal.v;
}

// ── $.set(signal, value) ───────────────────────────────────────────

export function set<T>(signal: Signal<T> | T, value: T): T {
	// Passthrough for non-signal values
	if (!isSignal(signal)) return value;

	// Unwrap signal proxies
	signal = getSignalTarget(signal);

	// Bind-derived with custom setter: delegate to parent's setter
	if (signal[SETTER]) {
		signal[SETTER](value);
		return value;
	}
	// Auto-proxy object values being stored in a signal (for reassignable objects)
	const stored = (typeof value === 'object' && value !== null) ? proxy(value) : value;
	if (Object.is(signal.v, stored)) return value;
	signal.v = stored;
	// Re-bridge new proxy to signal so future mutations notify subscribers
	if (typeof stored === 'object' && stored !== null && isProxy(stored)) {
		bridgeProxyToSignal(stored, signal);
	}
	notify(signal);
	return value;
}

// ── Notification ───────────────────────────────────────────────────

export function notify(signal: State): void {
	signal.version++;
	notifySubs(signal.subs);
}

function notifySubs(subs: Set<Subscriber>): void {
	for (const sub of subs) {
		if (sub.dirty) continue;
		sub.dirty = true;

		if (isDerived(sub)) {
			// Derived: just propagate dirty downstream (value is lazy — recomputed on read)
			notifySubs(sub.subs);
		} else {
			// Effect: schedule for execution in next microtask
			scheduleEffect(sub);
		}
	}
}
