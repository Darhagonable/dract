import { type State, SIGNAL, getSubscriber, notify } from './state';

// ── Symbols ────────────────────────────────────────────────────────

/** Symbol to retrieve the raw (unproxied) target */
export const RAW = Symbol('raw');

/** Brand symbol — proxy `has` trap returns true for this */
export const STATE_SYMBOL = Symbol('state_proxy');

// ── Proxy cache ────────────────────────────────────────────────────

const proxyCache = new WeakMap<object, any>();

/** Maps each proxy → its root signal (fires on any mutation) */
const proxySignals = new WeakMap<object, State>();

/** Get the root signal for a proxy (used by effect to subscribe to any change) */
export function getProxyState(p: any): State | undefined {
	return proxySignals.get(p);
}

export function isProxy(value: unknown): boolean {
	return !!value && typeof value === 'object' && STATE_SYMBOL in value;
}

// ── Internal signal helpers ────────────────────────────────────────

function source<T>(value: T): State<T> {
	return { v: value, version: 0, subs: new Set(), [SIGNAL]: true };
}

function trackRead(signal: State): void {
	const sub = getSubscriber();
	if (sub) {
		signal.subs.add(sub);
		sub.deps.add(signal);
	}
}

// ── Helpers ────────────────────────────────────────────────────────

function isPlainObject(value: any): value is Record<string | symbol, any> {
	if (typeof value !== 'object' || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function shouldProxy(value: any): boolean {
	if (typeof value !== 'object' || value === null) return false;
	if (isProxy(value)) return false; // already proxied
	return (
		Array.isArray(value) ||
		isPlainObject(value) ||
		value instanceof Map ||
		value instanceof Set ||
		value instanceof Date
	);
}

// ── Main entry ─────────────────────────────────────────────────────

export function proxy<T>(value: T, _parentRoot?: State): T {
	if (typeof value !== 'object' || value === null) return value;
	if (!shouldProxy(value)) return value;
	if (proxyCache.has(value)) return proxyCache.get(value);

	let result: any;

	if (value instanceof Map) {
		result = proxyMap(value, _parentRoot);
	} else if (value instanceof Set) {
		result = proxySet(value, _parentRoot);
	} else if (value instanceof Date) {
		result = proxyDate(value, _parentRoot);
	} else {
		result = proxyObject(value, _parentRoot);
	}

	proxyCache.set(value, result);
	return result;
}

// ── Object / Array proxy (per-property signals) ────────────────────

function proxyObject<T extends object>(target: T, parentRoot?: State): T {
	const sources = new Map<string | symbol, State>();
	const version = source(0);
	const root = source(0);

	function notifyRoots(): void {
		root.v++; notify(root);
		if (parentRoot) { parentRoot.v++; notify(parentRoot); }
	}

	const p: T = new Proxy(target, {
		get(obj, key, receiver) {
			if (key === STATE_SYMBOL) return true;
			if (key === RAW) return obj;
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				let s = sources.get(key);
				if (!s) {
					s = source(proxy((obj as any)[key], root));
					sources.set(key, s);
				}
				trackRead(s);
				return s.v;
			}
			const value = Reflect.get(obj, key, receiver);
			if (typeof value === 'function') return value;
			trackRead(version);
			return value;
		},
		set(obj, key, newValue) {
			const isNew = !Object.prototype.hasOwnProperty.call(obj, key);
			const proxied = proxy(newValue, root);
			let s = sources.get(key);
			if (!s) {
				// Use the OLD value so the Object.is check below detects the change
				const oldVal = isNew ? undefined : proxy((obj as any)[key], root);
				s = source(oldVal);
				sources.set(key, s);
			}
			(obj as any)[key] = newValue;
			if (!Object.is(s.v, proxied)) {
				s.v = proxied; notify(s); notifyRoots();
			}
			if (isNew) { version.v++; notify(version); }
			return true;
		},
		deleteProperty(obj, key) {
			const had = Object.prototype.hasOwnProperty.call(obj, key);
			const result = Reflect.deleteProperty(obj, key);
			if (had) {
				const s = sources.get(key);
				if (s) { s.v = undefined; notify(s); }
				sources.delete(key);
				version.v++; notify(version);
				notifyRoots();
			}
			return result;
		},
		has(obj, key) {
			if (key === STATE_SYMBOL) return true;
			trackRead(version);
			return Reflect.has(obj, key);
		},
		ownKeys(obj) {
			trackRead(version);
			return Reflect.ownKeys(obj);
		},
	});

	proxySignals.set(p, root);
	return p;
}

// ── Map proxy (per-key signals + version) ──────────────────────────

function proxyMap<K, V>(target: Map<K, V>, parentRoot?: State): Map<K, V> {
	const sources = new Map<K, State<V | undefined>>();
	const version = source(0);
	const root = source(0);

	function notifyRoots(): void {
		root.v++; notify(root);
		if (parentRoot) { parentRoot.v++; notify(parentRoot); }
	}

	function getSource(key: K): State<V | undefined> {
		let s = sources.get(key);
		if (!s) {
			s = source<V | undefined>(target.has(key) ? target.get(key)! : undefined);
			sources.set(key, s);
		}
		return s;
	}

	const result = new Proxy(target, {
		get(obj, prop) {
			if (prop === STATE_SYMBOL) return true;
			if (prop === RAW) return obj;

			switch (prop) {
				case 'get':
					return (key: K) => {
						const s = getSource(key);
						trackRead(s);
						return s.v;
					};
				case 'has':
					return (key: K) => {
						const s = getSource(key);
						trackRead(s);
						return obj.has(key);
					};
				case 'set':
					return (key: K, value: V) => {
						const isNew = !obj.has(key);
						const s = getSource(key); // get/create signal BEFORE mutation
						obj.set(key, value);
						const proxied = proxy(value);
						if (!Object.is(s.v, proxied)) {
							s.v = proxied;
							notify(s);
							notifyRoots();
						}
						if (isNew) {
							version.v++;
							notify(version);
						}
						return new Proxy(obj, this);
					};
				case 'delete':
					return (key: K) => {
						const had = obj.has(key);
						const result = obj.delete(key);
						if (had) {
							const s = sources.get(key);
							if (s) { s.v = undefined; notify(s); }
							sources.delete(key);
							version.v++; notify(version);
							notifyRoots();
						}
						return result;
					};
				case 'clear':
					return () => {
						if (obj.size > 0) {
							for (const s of sources.values()) { s.v = undefined; notify(s); }
							sources.clear();
							obj.clear();
							version.v++; notify(version);
							notifyRoots();
						}
					};
				case 'size':
					trackRead(version);
					return obj.size;
				case 'forEach':
					return (cb: (v: V, k: K, m: Map<K, V>) => void) => {
						trackRead(root);
						return obj.forEach(cb);
					};
				case 'keys':
					return () => { trackRead(version); return obj.keys(); };
				case 'values':
					return () => { trackRead(root); return obj.values(); };
				case 'entries':
					return () => { trackRead(root); return obj.entries(); };
				case Symbol.iterator:
					return () => { trackRead(root); return obj[Symbol.iterator](); };
				default:
					return Reflect.get(obj, prop);
			}
		},
		has(obj, key) {
			if (key === STATE_SYMBOL) return true;
			return Reflect.has(obj, key);
		},
	});

	proxySignals.set(result, root);
	return result;
}

// ── Set proxy (version signal) ─────────────────────────────────────

function proxySet<T>(target: Set<T>, parentRoot?: State): Set<T> {
	const version = source(0);
	const root = source(0);

	function notifyRoots(): void {
		root.v++; notify(root);
		if (parentRoot) { parentRoot.v++; notify(parentRoot); }
	}

	const result = new Proxy(target, {
		get(obj, prop) {
			if (prop === STATE_SYMBOL) return true;
			if (prop === RAW) return obj;

			switch (prop) {
				case 'has':
					return (v: T) => { trackRead(version); return obj.has(v); };
				case 'add':
					return (v: T) => {
						const had = obj.has(v);
						obj.add(v);
						if (!had) { version.v++; notify(version); notifyRoots(); }
						return new Proxy(obj, this);
					};
				case 'delete':
					return (v: T) => {
						const result = obj.delete(v);
						if (result) { version.v++; notify(version); notifyRoots(); }
						return result;
					};
				case 'clear':
					return () => {
						if (obj.size > 0) {
							obj.clear();
							version.v++; notify(version);
							notifyRoots();
						}
					};
				case 'size':
					trackRead(version);
					return obj.size;
				case 'forEach':
					return (cb: (v: T, v2: T, s: Set<T>) => void) => {
						trackRead(version);
						return obj.forEach(cb);
					};
				case 'keys':
					return () => { trackRead(version); return obj.keys(); };
				case 'values':
					return () => { trackRead(version); return obj.values(); };
				case 'entries':
					return () => { trackRead(version); return obj.entries(); };
				case Symbol.iterator:
					return () => { trackRead(version); return obj[Symbol.iterator](); };
				default:
					return Reflect.get(obj, prop);
			}
		},
		has(obj, key) {
			if (key === STATE_SYMBOL) return true;
			return Reflect.has(obj, key);
		},
	});

	proxySignals.set(result, root);
	return result;
}

// ── Date proxy (single signal) ─────────────────────────────────────

const DATE_SETTERS = new Set([
	'setDate', 'setFullYear', 'setHours', 'setMilliseconds', 'setMinutes',
	'setMonth', 'setSeconds', 'setTime', 'setUTCDate', 'setUTCFullYear',
	'setUTCHours', 'setUTCMilliseconds', 'setUTCMinutes', 'setUTCMonth',
	'setUTCSeconds', 'setYear',
]);

function proxyDate(target: Date, parentRoot?: State): Date {
	const sig = source(0);

	function notifyRoots(): void {
		sig.v++; notify(sig);
		if (parentRoot) { parentRoot.v++; notify(parentRoot); }
	}

	const result = new Proxy(target, {
		get(obj, key) {
			if (key === STATE_SYMBOL) return true;
			if (key === RAW) return obj;

			const value = Reflect.get(obj, key);

			if (typeof value === 'function') {
				if (typeof key === 'string' && DATE_SETTERS.has(key)) {
					return (...args: any[]) => {
						const result = value.apply(obj, args);
						notifyRoots();
						return result;
					};
				}
				trackRead(sig);
				return value.bind(obj);
			}

			trackRead(sig);
			return value;
		},
		has(obj, key) {
			if (key === STATE_SYMBOL) return true;
			return Reflect.has(obj, key);
		},
	});

	proxySignals.set(result, sig);
	return result;
}
