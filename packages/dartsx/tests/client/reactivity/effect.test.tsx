import { describe, it, expect } from 'vitest';
import { effect, onCleanup, tick } from 'dartsx';

describe('reactivity > effect watch', () => {
	it('runs effect when dependency changes', async () => {
		component EffectWatch() {
			state count = 0;
			state log = '';

			effect(count, (value, prev) => {
				log = prev + ' -> ' + value;
			});

			render (
				<button onclick={() => count++}>increment</button>
				<p>{log}</p>
			);
		}

		mountComponent(EffectWatch);
		expect(container.querySelector('p').textContent).toBe('0 -> 0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('p').textContent).toBe('0 -> 1');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('p').textContent).toBe('1 -> 2');
	});

	it('watches proxy state changes', async () => {
		component ProxyEffect() {
			state obj = { count: 0, label: 'hi' };
			state log = '';

			effect(obj, (newObj, oldObj) => {
				log = oldObj.count + ' -> ' + newObj.count;
			});

			render (
				<button onclick={() => obj.count = 5}>set5</button>
				<p>{log}</p>
			);
		}

		mountComponent(ProxyEffect);
		expect(container.querySelector('p').textContent).toBe('0 -> 0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('p').textContent).toBe('0 -> 5');
	});

	it('onCleanup runs before effect re-runs', async () => {
		component CleanupEffect() {
			state count = 0;
			state cleanupLog = '';

			effect(count, (val) => {
				onCleanup(() => {
					cleanupLog = 'cleaned:' + val;
				});
			});

			render (
				<button onclick={() => count++}>inc</button>
				<span>{cleanupLog}</span>
			);
		}

		mountComponent(CleanupEffect);
		// Initially no cleanup has run
		expect(container.querySelector('span').textContent).toBe('');

		container.querySelector('button').click();
		await tick();
		// Cleanup from first run (val=0) should have fired
		expect(container.querySelector('span').textContent).toBe('cleaned:0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('cleaned:1');
	});
});

describe('reactivity > effect with multiple deps', () => {
	it('watches multiple dependencies with pairs callback', async () => {
		component MultiEffect() {
			state a = 'foo';
			state b = 'bar';
			state log = '';

			effect([a, b], ([newA, prevA], [newB, prevB]) => {
				log = prevA + ',' + prevB + '->' + newA + ',' + newB;
			});

			render (
				<button class="a" onclick={() => a = a + 'o'}>a</button>
				<button class="b" onclick={() => b = b + 'a'}>b</button>
				<span>{log}</span>
			);
		}

		mountComponent(MultiEffect);
		// Initial run: old === new
		expect(container.querySelector('span').textContent).toBe('foo,bar->foo,bar');

		container.querySelector('.a').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('foo,bar->fooo,bar');
	});
});

describe('reactivity > effect on nested property', () => {
	it('watches a specific property of a proxy', async () => {
		component NestedEffect() {
			state user = { name: 'Alice', age: 30 };
			state log = '';

			effect(user.name, (name, prevName) => {
				log = prevName + '->' + name;
			});

			render (
				<button class="name" onclick={() => user.name = 'Bob'}>name</button>
				<button class="age" onclick={() => user.age = 31}>age</button>
				<span>{log}</span>
			);
		}

		mountComponent(NestedEffect);
		expect(container.querySelector('span').textContent).toBe('Alice->Alice');

		container.querySelector('.name').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('Alice->Bob');

		// Changing age should NOT fire the name effect
		const prevLog = container.querySelector('span').textContent;
		container.querySelector('.age').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe(prevLog);
	});
});
