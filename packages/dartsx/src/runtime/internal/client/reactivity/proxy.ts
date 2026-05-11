import { type State, SIGNAL, SETTER, getSubscriber, notify } from './state';

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
	return !!value && (typeof value === 'object' || typeof value === 'function') && STATE_SYMBOL in value;
}

// ── Signal proxy (value-forwarding wrapper) ────────────────────────
//
// Wraps a signal object so property access delegates to a dynamically
// resolved value. Used by derived() so object-valued computations
// can be accessed directly (e.g. rest.role instead of $.get(rest).role).

/** Maps signal proxy → raw signal target */
const signalProxyTargets = new WeakMap<object, any>();

/** Unwrap a signal proxy to its raw signal target. Returns value as-is if not wrapped. */
export function getSignalTarget<T extends object>(value: T): T {
	return (signalProxyTargets.get(value)) ?? value;
}

function isObjectLike(value: unknown): value is object {
	return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Create a proxy that wraps a signal and forwards property access
 * to a dynamically resolved value. The signal retains its SIGNAL brand.
 */
export function signalProxy<T extends object>(
	signal: T,
	getValue: (raw: T) => unknown,
): T {
	// If the value is a function, we need a callable target for the proxy
	// so that [[Call]] is available as an internal method.
	const currentValue = getValue(signal);
	const target = typeof currentValue === 'function'
		? Object.assign(function () { }, { [SIGNAL]: true }) as unknown as T
		: signal;

	const p = new Proxy<T>(target, {
		get(_target, key) {
			if (key === SIGNAL) return true;
			if (key === SETTER) return (signal as any)[SETTER];

			const value = getValue(signal);
			if (value == null) return undefined;

			const prop = (value as any)[key];
			if (typeof prop === 'function') return prop.bind(value);
			return prop;
		},
		set(_target, key, newValue) {
			if (key === SETTER) {
				(signal as any)[SETTER] = newValue;
				return true;
			}
			const current = getValue(signal);
			if (!isObjectLike(current)) return false;
			return Reflect.set(current, key, newValue);
		},
		has(_target, key) {
			if (key === SIGNAL) return true;
			if (key === SETTER) return SETTER in signal;
			const value = getValue(signal);
			return isObjectLike(value) ? key in value : false;
		},
		ownKeys(_target) {
			const value = getValue(signal);
			return isObjectLike(value) ? Reflect.ownKeys(value) : [];
		},
		getOwnPropertyDescriptor(_target, key) {
			if (key === SIGNAL) {
				return { configurable: true, enumerable: false, value: true, writable: false };
			}
			if (key === SETTER && SETTER in signal) {
				return { configurable: true, enumerable: false, value: (signal as any)[SETTER], writable: true };
			}
			const value = getValue(signal);
			if (!isObjectLike(value)) return undefined;
			const desc = Reflect.getOwnPropertyDescriptor(value, key);
			if (!desc) return undefined;
			return { ...desc, configurable: true };
		},
		deleteProperty(_target, key) {
			if (key === SIGNAL || key === SETTER) return false;
			const value = getValue(signal);
			if (!isObjectLike(value)) return false;
			return Reflect.deleteProperty(value, key);
		},
		apply(_target, thisArg, argList) {
			const value = getValue(signal);
			if (typeof value === 'function') {
				return Reflect.apply(value, thisArg, argList);
			}
			throw new TypeError('not a function');
		},
	});

	signalProxyTargets.set(p, signal);
	return p;
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
	if (typeof value === 'function') return true;
	if (typeof value !== 'object' || value === null) return false;
	if (isProxy(value)) return false; // already proxied
	return (
		Array.isArray(value) ||
		isPlainObject(value) ||
		value instanceof Map ||
		value instanceof Set ||
		value instanceof Date ||
		value instanceof URL ||
		value instanceof URLSearchParams
	);
}

// ── Main entry ─────────────────────────────────────────────────────

export function proxy<T>(value: T, _parentRoot?: State): T {
	if (typeof value !== 'object' && typeof value !== 'function') return value;
	if (value === null) return value;
	if (!shouldProxy(value)) return value;
	if (proxyCache.has(value)) return proxyCache.get(value);

	let result: any;

	if (value instanceof Map) {
		result = proxyMap(value, _parentRoot);
	} else if (value instanceof Set) {
		result = proxySet(value, _parentRoot);
	} else if (value instanceof Date) {
		result = proxyDate(value, _parentRoot);
	} else if (value instanceof URL) {
		result = new ReactiveURL(value);
	} else if (value instanceof URLSearchParams) {
		result = new ReactiveURLSearchParams(value);
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

// ── URL / URLSearchParams reactive wrappers ────────────────────────

export const REPLACE = Symbol();

let current_url: ReactiveURL | null = null;

export class ReactiveURLSearchParams extends URLSearchParams {
	[STATE_SYMBOL] = true;
	#version = source(0);
	#url = current_url;
	#updating = false;

	constructor(init?: string | URLSearchParams | Record<string, string> | [string, string][]) {
		super(init as any);
		proxySignals.set(this, this.#version);
	}

	#increment() {
		this.#version.v++; notify(this.#version);
	}

	#update_url() {
		if (!this.#url || this.#updating) return;
		this.#updating = true;
		const search = super.toString();
		this.#url.search = search ? `?${search}` : '';
		this.#updating = false;
	}

	/** @internal — bulk replace (used by ReactiveURL) */
	[REPLACE](params: URLSearchParams): void {
		if (this.#updating) return;
		this.#updating = true;
		for (const key of [...super.keys()]) {
			super.delete(key);
		}
		for (const [key, value] of params) {
			super.append(key, value);
		}
		this.#increment();
		this.#updating = false;
	}

	// ── Write methods ──────────────────────────────────────────────

	append(name: string, value: string): void {
		super.append(name, value);
		this.#update_url();
		this.#increment();
	}

	delete(name: string, value?: string): void {
		const had = super.has(name, value);
		super.delete(name, value);
		if (had) {
			this.#update_url();
			this.#increment();
		}
	}

	set(name: string, value: string): void {
		const previous = super.getAll(name).join('');
		super.set(name, value);
		if (previous !== super.getAll(name).join('')) {
			this.#update_url();
			this.#increment();
		}
	}

	sort(): void {
		super.sort();
		this.#update_url();
		this.#increment();
	}

	// ── Read methods ───────────────────────────────────────────────

	get(name: string): string | null {
		trackRead(this.#version);
		return super.get(name);
	}

	getAll(name: string): string[] {
		trackRead(this.#version);
		return super.getAll(name);
	}

	has(name: string, value?: string): boolean {
		trackRead(this.#version);
		return super.has(name, value);
	}

	toString(): string {
		trackRead(this.#version);
		return super.toString();
	}

	get size(): number {
		trackRead(this.#version);
		return super.size;
	}

	// ── Iterators ──────────────────────────────────────────────────

	keys() { trackRead(this.#version); return super.keys(); }
	values() { trackRead(this.#version); return super.values(); }
	entries() { trackRead(this.#version); return super.entries(); }

	forEach(callback: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: any): void {
		trackRead(this.#version);
		super.forEach(callback, thisArg);
	}

	[Symbol.iterator]() { return this.entries(); }
}

export class ReactiveURL extends URL {
	[STATE_SYMBOL] = true;
	#root = source(0);
	#protocol = source(super.protocol);
	#username = source(super.username);
	#password = source(super.password);
	#hostname = source(super.hostname);
	#port = source(super.port);
	#pathname = source(super.pathname);
	#hash = source(super.hash);
	#search = source(super.search);
	#searchParams: ReactiveURLSearchParams;

	constructor(url: string | URL, base?: string | URL) {
		url = new URL(url, base);
		super(url);
		current_url = this;
		this.#searchParams = new ReactiveURLSearchParams(url.searchParams);
		current_url = null;
		proxySignals.set(this, this.#root);
	}

	#notifyRoot() {
		this.#root.v++; notify(this.#root);
	}

	// ── Properties ─────────────────────────────────────────────────

	get hash() { trackRead(this.#hash); return this.#hash.v as string; }
	set hash(value: string) {
		super.hash = value;
		this.#hash.v = super.hash; notify(this.#hash);
		this.#notifyRoot();
	}

	get host() {
		trackRead(this.#hostname);
		trackRead(this.#port);
		return super.host;
	}
	set host(value: string) {
		super.host = value;
		this.#hostname.v = super.hostname; notify(this.#hostname);
		this.#port.v = super.port; notify(this.#port);
		this.#notifyRoot();
	}

	get hostname() { trackRead(this.#hostname); return this.#hostname.v as string; }
	set hostname(value: string) {
		super.hostname = value;
		this.#hostname.v = super.hostname; notify(this.#hostname);
		this.#notifyRoot();
	}

	get href() {
		trackRead(this.#protocol);
		trackRead(this.#username);
		trackRead(this.#password);
		trackRead(this.#hostname);
		trackRead(this.#port);
		trackRead(this.#pathname);
		trackRead(this.#hash);
		trackRead(this.#search);
		return super.href;
	}
	set href(value: string) {
		super.href = value;
		this.#protocol.v = super.protocol; notify(this.#protocol);
		this.#username.v = super.username; notify(this.#username);
		this.#password.v = super.password; notify(this.#password);
		this.#hostname.v = super.hostname; notify(this.#hostname);
		this.#port.v = super.port; notify(this.#port);
		this.#pathname.v = super.pathname; notify(this.#pathname);
		this.#hash.v = super.hash; notify(this.#hash);
		this.#search.v = super.search; notify(this.#search);
		this.#searchParams[REPLACE](super.searchParams);
		this.#notifyRoot();
	}

	get password() { trackRead(this.#password); return this.#password.v as string; }
	set password(value: string) {
		super.password = value;
		this.#password.v = super.password; notify(this.#password);
		this.#notifyRoot();
	}

	get pathname() { trackRead(this.#pathname); return this.#pathname.v as string; }
	set pathname(value: string) {
		super.pathname = value;
		this.#pathname.v = super.pathname; notify(this.#pathname);
		this.#notifyRoot();
	}

	get port() { trackRead(this.#port); return this.#port.v as string; }
	set port(value: string) {
		super.port = value;
		this.#port.v = super.port; notify(this.#port);
		this.#notifyRoot();
	}

	get protocol() { trackRead(this.#protocol); return this.#protocol.v as string; }
	set protocol(value: string) {
		super.protocol = value;
		this.#protocol.v = super.protocol; notify(this.#protocol);
		this.#notifyRoot();
	}

	get search() { trackRead(this.#search); return this.#search.v as string; }
	set search(value: string) {
		super.search = value;
		this.#search.v = super.search; notify(this.#search);
		this.#searchParams[REPLACE](super.searchParams);
		this.#notifyRoot();
	}

	get username() { trackRead(this.#username); return this.#username.v as string; }
	set username(value: string) {
		super.username = value;
		this.#username.v = super.username; notify(this.#username);
		this.#notifyRoot();
	}

	get origin() {
		trackRead(this.#protocol);
		trackRead(this.#hostname);
		trackRead(this.#port);
		return super.origin;
	}

	get searchParams() { return this.#searchParams; }

	toString() { return this.href; }
	toJSON() { return this.href; }
}
