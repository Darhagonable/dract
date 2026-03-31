import { derived, type Derived } from './derived';
import { SETTER, type State } from './state';
import type { BindTuple } from '../bindings/types';

// ── $.prop(propsObj, key, defaultValue?) — read-only prop ──────────
// ── $.prop.bind(propsObj, key, defaultValue?) — two-way bindable prop

export interface PropFunction {
    <T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): Derived<T>;
    bind<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): State<T> | Derived<T>;
}

function resolveProp<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): Derived<T> {
    return derived(() => {
        const getter = propsObj[key];
        const val = typeof getter === 'function' ? getter() : getter;
        return val === undefined && defaultValue !== undefined ? defaultValue! : val;
    });
}

let prop: PropFunction;

prop = function prop<T>(propsObj: Record<string, unknown>, key: string, defaultValue?: T): Derived<T> {
    return resolveProp(propsObj, key, defaultValue);
};

prop.bind = function bindProp<T>(propsObj: Record<string, BindTuple<T>>, key: string, defaultValue?: T): State<T> | Derived<T> {
    const bindKey = `bind:${key}`;
    if (bindKey in propsObj) {
        const [getter, setter] = propsObj[bindKey];
        const d = derived(getter);
        d[SETTER] = setter;
        return d;
    }
    return resolveProp(propsObj, key, defaultValue);
};

export { prop };
