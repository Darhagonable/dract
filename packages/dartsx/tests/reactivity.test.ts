import { describe, it, expect } from 'vitest';
import {
    state,
    get,
    set,
    type Signal,
    getFlushPromise,
} from '../src/runtime/internal/client/reactivity/state';
import {
    derived,
    getDerived,
} from '../src/runtime/internal/client/reactivity/derived';
import { proxy } from '../src/runtime/internal/client/reactivity/proxy';
import { tick } from '../src/runtime/external/tick';
import { effect } from '../src/runtime/external/effect';
import { onCleanup } from '../src/runtime/external/onCleanup';

describe('state', () => {
    it('creates a signal with an initial value', () => {
        const sig = state(42);
        expect(sig.v).toBe(42);
        expect(sig.version).toBe(0);
    });

    it('reads the current value with get()', () => {
        const sig = state('hello');
        expect(get(sig)).toBe('hello');
    });

    it('updates the value with set()', () => {
        const sig = state(0);
        set(sig, 10);
        expect(get(sig)).toBe(10);
        expect(sig.version).toBe(1);
    });

    it('does not bump version for identical values', () => {
        const sig = state(5);
        set(sig, 5);
        expect(sig.version).toBe(0);
    });

    it('notifies subscribers when value changes', () => {
        const sig = state(0);
        let notified = false;
        const sub = {
            run() { notified = true; },
            deps: new Set<Signal>(),
            dirty: false,
        };
        sig.subs.add(sub);
        set(sig, 1);
        expect(sub.dirty).toBe(true);
    });
});

describe('derived', () => {
    it('computes a derived value lazily', () => {
        const count = state(5);
        const doubled = derived(() => get(count) * 2);

        expect(doubled.initialized).toBe(false);
        expect(getDerived(doubled)).toBe(10);
        expect(doubled.initialized).toBe(true);
    });

    it('recomputes when dependency changes', () => {
        const count = state(3);
        const doubled = derived(() => get(count) * 2);

        expect(getDerived(doubled)).toBe(6);
        set(count, 7);
        expect(doubled.dirty).toBe(true);
        expect(getDerived(doubled)).toBe(14);
        expect(doubled.dirty).toBe(false);
    });

    it('skips downstream updates when value is unchanged', () => {
        const count = state(5);
        const large = derived(() => get(count) > 10);

        expect(getDerived(large)).toBe(false);

        set(count, 8);
        const prevVersion = large.version;
        getDerived(large);
        expect(large.version).toBe(prevVersion);

        set(count, 15);
        getDerived(large);
        expect(getDerived(large)).toBe(true);
    });

    it('handles chain of derived values', () => {
        const a = state(2);
        const b = derived(() => get(a) * 3);
        const c = derived(() => getDerived(b) + 1);

        expect(getDerived(c)).toBe(7);
        set(a, 4);
        expect(getDerived(c)).toBe(13);
    });
});

describe('tick', () => {
    it('resolves after pending state changes flush', async () => {
        const count = state(0);
        let effectRan = false;

        const sub = {
            run() { effectRan = true; },
            deps: new Set<Signal>(),
            dirty: false,
        };
        count.subs.add(sub);

        set(count, 1);
        expect(effectRan).toBe(false);

        await tick();
        expect(effectRan).toBe(true);
    });

    it('resolves immediately when no changes pending', async () => {
        const before = Date.now();
        await tick();
        const after = Date.now();
        expect(after - before).toBeLessThan(50);
    });
});

describe('user effect', () => {
    it('runs with single dependency (primitive)', async () => {
        const count = state(0);
        const values: number[] = [];

        effect(count, (newVal: number) => {
            values.push(newVal);
        });

        expect(values).toEqual([0]);

        set(count, 5);
        await tick();
        expect(values).toEqual([0, 5]);
    });

    it('runs with multiple dependencies', async () => {
        const a = state(1);
        const b = state(2);
        const results: number[][][] = [];

        effect([a, b], ([newA, oldA], [newB, oldB]) => {
            results.push([[newA, oldA], [newB, oldB]]);
        });

        expect(results).toEqual([[[1, 1], [2, 2]]]);

        set(a, 10);
        await tick();
        expect(results).toEqual([[[1, 1], [2, 2]], [[10, 1], [2, 2]]]);
    });

    it('runs with proxy as dependency', async () => {
        const obj = proxy({ count: 0 });
        const values: number[] = [];

        effect(obj, (val: any) => {
            values.push(val.count);
        });

        expect(values).toEqual([0]);

        obj.count = 5;
        await tick();
        expect(values).toEqual([0, 5]);
    });

    it('runs with mixed signals and proxies as deps', async () => {
        const count = state(0);
        const obj = proxy({ name: 'alice' });
        const values: string[] = [];

        effect([obj, count], ([newObj, _oldObj], [newCount, _oldCount]) => {
            values.push(`${(newObj as any).name}:${newCount}`);
        });

        expect(values).toEqual(['alice:0']);

        obj.name = 'bob';
        await tick();
        expect(values).toEqual(['alice:0', 'bob:0']);

        set(count, 1);
        await tick();
        expect(values).toEqual(['alice:0', 'bob:0', 'bob:1']);
    });
});

describe('deep reactivity', () => {
    it('tracks property reads on plain objects', () => {
        const obj = proxy({ name: 'alice', age: 30 });
        const d = derived(() => obj.name);
        expect(getDerived(d)).toBe('alice');
    });

    it('reacts to property mutation on objects', async () => {
        const obj = proxy({ count: 0 });
        const values: number[] = [];

        effect(obj, (val: any) => {
            values.push(val.count);
        });

        expect(values).toEqual([0]);

        obj.count = 5;
        await tick();
        expect(values).toEqual([0, 5]);
    });

    it('reacts to nested property mutation', async () => {
        const obj = proxy({ nested: { value: 'hello' } });
        const values: string[] = [];

        effect(obj, (val: any) => {
            values.push(val.nested.value);
        });

        expect(values).toEqual(['hello']);

        obj.nested.value = 'world';
        await tick();
        expect(values).toEqual(['hello', 'world']);
    });

    it('reacts to array push', async () => {
        const arr = proxy([1, 2, 3]);
        const lengths: number[] = [];

        effect(arr, (val: any) => {
            lengths.push(val.length);
        });

        expect(lengths).toEqual([3]);

        arr.push(4);
        await tick();
        expect(lengths).toEqual([3, 4]);
    });

    it('reacts to array index mutation', async () => {
        const arr = proxy(['a', 'b', 'c']);
        const values: string[] = [];

        effect(arr, (val: any) => {
            values.push(val[0]);
        });

        expect(values).toEqual(['a']);

        arr[0] = 'z';
        await tick();
        expect(values).toEqual(['a', 'z']);
    });

    it('reacts to Map.set()', async () => {
        const map = proxy(new Map([['a', 1]]));
        const values: number[] = [];

        effect(map, (val: any) => {
            values.push(val.get('a'));
        });

        expect(values).toEqual([1]);

        map.set('a', 99);
        await tick();
        expect(values).toEqual([1, 99]);
    });

    it('reacts to Map.delete()', async () => {
        const map = proxy(new Map([['a', 1], ['b', 2]]));
        const sizes: number[] = [];

        effect(map, (val: any) => {
            sizes.push(val.size);
        });

        expect(sizes).toEqual([2]);

        map.delete('a');
        await tick();
        expect(sizes).toEqual([2, 1]);
    });

    it('reacts to Set.add()', async () => {
        const s = proxy(new Set([1, 2]));
        const sizes: number[] = [];

        effect(s, (val: any) => {
            sizes.push(val.size);
        });

        expect(sizes).toEqual([2]);

        s.add(3);
        await tick();
        expect(sizes).toEqual([2, 3]);
    });

    it('reacts to Set.delete()', async () => {
        const s = proxy(new Set([1, 2, 3]));
        const sizes: number[] = [];

        effect(s, (val: any) => {
            sizes.push(val.size);
        });

        expect(sizes).toEqual([3]);

        s.delete(2);
        await tick();
        expect(sizes).toEqual([3, 2]);
    });

    it('reacts to Date setter methods', async () => {
        const d = proxy(new Date(2020, 0, 1));
        const years: number[] = [];

        effect(d, (val: any) => {
            years.push(val.getFullYear());
        });

        expect(years).toEqual([2020]);

        d.setFullYear(2025);
        await tick();
        expect(years).toEqual([2020, 2025]);
    });

    it('does not react when setting same primitive value on object', async () => {
        const obj = proxy({ x: 10 });
        let runs = 0;

        effect(obj, () => {
            runs++;
        });

        expect(runs).toBe(1);

        obj.x = 10; // same value
        await tick();
        expect(runs).toBe(1);
    });

    it('derived tracks deep property reads', () => {
        const obj = proxy({ items: [{ name: 'a' }, { name: 'b' }] });
        const names = derived(() => obj.items.map((i: any) => i.name).join(','));
        expect(getDerived(names)).toBe('a,b');

        obj.items[0].name = 'z';
        expect(getDerived(names)).toBe('z,b');
    });

    it('state() returns proxy for objects', () => {
        const obj = state({ name: 'alice' });
        expect(obj.name).toBe('alice');
        obj.name = 'bob';
        expect(obj.name).toBe('bob');
    });

    it('state() returns signal for primitives', () => {
        const count = state(0);
        expect(get(count)).toBe(0);
        set(count, 5);
        expect(get(count)).toBe(5);
    });

    it('reassignable object pattern: state(proxy(obj))', async () => {
        const objSig = state(proxy({ name: 'alice' })) as Signal<{ name: string }>;
        const values: string[] = [];

        effect(objSig, (val: any) => {
            values.push(val.name);
        });

        expect(values).toEqual(['alice']);

        // Swap the whole object
        set(objSig, proxy({ name: 'bob' }));
        await tick();
        expect(values).toEqual(['alice', 'bob']);
    });

    it('reacts to nested property as dep (derived from proxy property)', async () => {
        const obj = proxy({ count: 0 });
        const values: number[] = [];

        // This is what the compiler generates for: effect(obj.count, cb)
        const countDep = derived(() => obj.count);
        effect(countDep, (count: number, prevCount: number) => {
            values.push(count);
        });

        expect(values).toEqual([0]);

        obj.count = 5;
        await tick();
        expect(values).toEqual([0, 5]);

        obj.count = 5; // same value — should not re-fire
        await tick();
        expect(values).toEqual([0, 5]);

        obj.count = 10;
        await tick();
        expect(values).toEqual([0, 5, 10]);
    });

    it('reacts to multiple nested property deps', async () => {
        const obj = proxy({ a: 1, b: 2 });
        const sums: number[] = [];

        // Compiler would generate derived for each member-expression dep
        const aDep = derived(() => obj.a);
        const bDep = derived(() => obj.b);
        effect([aDep, bDep], ([a]: [number, number], [b]: [number, number]) => {
            sums.push(a + b);
        });

        expect(sums).toEqual([3]);

        obj.a = 10;
        await tick();
        expect(sums).toEqual([3, 12]);
    });

    it('proxy effect provides comparable old and new snapshots', async () => {
        const obj = proxy({ count: 0, label: 'hi' });
        const log: { oldCount: number; newCount: number }[] = [];

        effect(obj, (newObj: any, oldObj: any) => {
            log.push({ oldCount: oldObj.count, newCount: newObj.count });
        });

        // Initial run: old === new (both snapshots of initial state)
        expect(log).toEqual([{ oldCount: 0, newCount: 0 }]);

        obj.count = 5;
        await tick();
        expect(log).toEqual([
            { oldCount: 0, newCount: 0 },
            { oldCount: 0, newCount: 5 },
        ]);

        obj.count = 10;
        await tick();
        expect(log).toEqual([
            { oldCount: 0, newCount: 0 },
            { oldCount: 0, newCount: 5 },
            { oldCount: 5, newCount: 10 },
        ]);
    });

    it('onCleanup inside effect runs before re-run', async () => {
        const count = state(0);
        const cleanupLog: number[] = [];
        const runLog: number[] = [];

        effect(count, (val: number) => {
            runLog.push(val);
            onCleanup(() => cleanupLog.push(val));
        });

        expect(runLog).toEqual([0]);
        expect(cleanupLog).toEqual([]);

        set(count, 1);
        await tick();
        // cleanup from first run fires before second run
        expect(cleanupLog).toEqual([0]);
        expect(runLog).toEqual([0, 1]);

        set(count, 2);
        await tick();
        expect(cleanupLog).toEqual([0, 1]);
        expect(runLog).toEqual([0, 1, 2]);
    });
});
