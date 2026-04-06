import { type State, type Signal, type Subscriber, SIGNAL, getSubscriber, setSubscriber, isSignal } from './state';
import { proxy, signalProxy, getSignalTarget } from './proxy';

const UNINITIALIZED: unique symbol = Symbol('uninitialized');

export interface Derived<T = any> extends State<T>, Subscriber {
	fn: () => T;
}

// ── $.derived(fn) ──────────────────────────────────────────────────

export function isDerived<T>(value: Signal<T> | T): value is Derived<T> {
	return isSignal(value) && 'fn' in getSignalTarget(value);
}

export function derived<T>(fn: () => T): Derived<T> {
	const sig: Derived<T> = {
		v: UNINITIALIZED as T,
		version: 0,
		subs: new Set(),
		[SIGNAL]: true,
		fn,
		dirty: true,
		deps: new Set(),
		run() { sig.dirty = true; },
	};

	return signalProxy(sig, (raw) => getDerived(raw));
}

// ── Lazy pull evaluation ───────────────────────────────────────────

export function getDerived<T>(signal: Derived<T>): T {
	signal = getSignalTarget(signal);

	if (signal.dirty) {
		for (const dep of signal.deps) dep.subs.delete(signal);
		signal.deps.clear();

		const prev = setSubscriber(signal);
		const newVal = signal.fn();
		setSubscriber(prev);

		const stored = (typeof newVal === 'object' && newVal !== null) ? proxy(newVal) : newVal;
		if (!Object.is(signal.v, stored)) {
			signal.v = stored;
			signal.version++;
		}
		signal.dirty = false;
	}

	const outer = getSubscriber();
	if (outer) {
		signal.subs.add(outer);
		outer.deps.add(signal);
	}

	return signal.v;
}
