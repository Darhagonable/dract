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
import { tick } from '../src/runtime/external/tick';
import { effect } from '../src/runtime/external/effect';

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

        // Not computed until first read
        expect(doubled.initialized).toBe(false);

        // First read triggers computation
        expect(getDerived(doubled)).toBe(10);
        expect(doubled.initialized).toBe(true);
    });

    it('recomputes when dependency changes', () => {
        const count = state(3);
        const doubled = derived(() => get(count) * 2);

        expect(getDerived(doubled)).toBe(6);

        // Change the dependency
        set(count, 7);

        // Derived should be marked dirty
        expect(doubled.dirty).toBe(true);

        // Reading should recompute
        expect(getDerived(doubled)).toBe(14);
        expect(doubled.dirty).toBe(false);
    });

    it('skips downstream updates when value is unchanged', () => {
        const count = state(5);
        const large = derived(() => get(count) > 10);

        expect(getDerived(large)).toBe(false);

        // Change count but large stays false
        set(count, 8);
        const prevVersion = large.version;
        getDerived(large); // re-evaluate
        expect(large.version).toBe(prevVersion); // version didn't change

        // Now make it true
        set(count, 15);
        getDerived(large);
        expect(getDerived(large)).toBe(true);
    });

    it('handles chain of derived values', () => {
        const a = state(2);
        const b = derived(() => get(a) * 3);
        const c = derived(() => getDerived(b) + 1);

        expect(getDerived(c)).toBe(7); // 2*3 + 1

        set(a, 4);
        expect(getDerived(c)).toBe(13); // 4*3 + 1
    });
});

describe('tick', () => {
    it('resolves after pending state changes flush', async () => {
        const count = state(0);
        let effectRan = false;

        // Create a subscriber that tracks effect execution
        const sub = {
            run() { effectRan = true; },
            deps: new Set<Signal>(),
            dirty: false,
        };
        count.subs.add(sub);

        set(count, 1);
        expect(effectRan).toBe(false); // not yet — batched

        await tick();
        // After tick, the flush should have happened and run() was called
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
    it('runs with single dependency', async () => {
        const count = state(0);
        const values: number[] = [];

        effect(count, (newVal: number) => {
            values.push(newVal);
        });

        expect(values).toEqual([0]); // initial run

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

        expect(results).toEqual([[[1, 1], [2, 2]]]); // initial: new === old

        set(a, 10);
        await tick();
        expect(results).toEqual([[[1, 1], [2, 2]], [[10, 1], [2, 2]]]);
    });

});
