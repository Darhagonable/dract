import { derived, type Derived } from './derived';
import { SETTER, type State } from './state';

// ── $.prop(propsObj, key, defaultValue?) — read-only prop ──────────
// ── $.prop.bind(propsObj, key, defaultValue?) — two-way bindable prop

export interface PropFunction {
	<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): Derived<T>;
	bind<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): State<T> | Derived<T>;
}

function resolveProp<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): Derived<T> {
	return derived(() => {
		// Reactive props use object getters (get key() { ... }) so reading
		// the property transparently triggers reactivity tracking.
		// Callback functions are passed as plain values, no ambiguity.
		const val = propsObj[key];
		return val === undefined && defaultValue !== undefined ? defaultValue! : val as T;
	});
}

let prop: PropFunction;

prop = function prop<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): Derived<T> {
	return resolveProp(propsObj, key, defaultValue);
};

prop.bind = function bindProp<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): State<T> | Derived<T> {
	const prop = resolveProp(propsObj, key, defaultValue);
	const desc = Object.getOwnPropertyDescriptor(propsObj, key);
	if (desc?.set) prop[SETTER] = desc.set;
	return prop;
};

export { prop };
