import { describe, it, expect } from 'vitest';
import { effect, tick } from 'dartsx';

describe('reactivity > state basic counter', () => {
	it('increments count on click', async () => {
		component Counter() {
			state count = 0;

			render (
				<button onclick={() => count++}>
					clicks: {count}
				</button>
			);
		}

		mountComponent(Counter);
		const btn = container.querySelector('button');
		expect(btn.textContent).toBe('clicks: 0');

		btn.click();
		await tick();
		expect(btn.textContent).toBe('clicks: 1');

		btn.click();
		await tick();
		expect(btn.textContent).toBe('clicks: 2');
	});

	it('does not re-render when set to same value', async () => {
		component SameValue() {
			state count = 5;

			render (
				<button onclick={() => count = 5}>noop</button>
				<span>{count}</span>
			);
		}

		mountComponent(SameValue);
		expect(container.querySelector('span').textContent).toBe('5');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('5');
	});
});

describe('reactivity > state proxy object', () => {
	it('reacts to property mutations on object state', async () => {
		component ProxyObj() {
			state user = { name: 'Alice', age: 30 };

			render (
				<button onclick={() => user.name = 'Bob'}>rename</button>
				<span>{user.name}</span>
			);
		}

		mountComponent(ProxyObj);
		expect(container.querySelector('span').textContent).toBe('Alice');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('Bob');
	});

	it('reacts to nested property mutations', async () => {
		component NestedProxy() {
			state data = { nested: { value: 'hello' } };

			render (
				<button onclick={() => data.nested.value = 'world'}>change</button>
				<span>{data.nested.value}</span>
			);
		}

		mountComponent(NestedProxy);
		expect(container.querySelector('span').textContent).toBe('hello');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('world');
	});

	it('reacts to array push', async () => {
		component ArrayPush() {
			state items = ['a', 'b'];

			render (
				<button onclick={() => items.push('c')}>add</button>
				<span>{items.length}</span>
			);
		}

		mountComponent(ArrayPush);
		expect(container.querySelector('span').textContent).toBe('2');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('3');
	});

	it('reacts to array index mutation', async () => {
		component ArrayIndex() {
			state items = ['a', 'b', 'c'];

			render (
				<button onclick={() => items[0] = 'z'}>change</button>
				<span>{items[0]}</span>
			);
		}

		mountComponent(ArrayIndex);
		expect(container.querySelector('span').textContent).toBe('a');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('z');
	});
});

describe('reactivity > Map state', () => {
	it('reacts to Map.set()', async () => {
		component MapTest() {
			state scores = new Map([['alice', 10]]);
			derived total = Array.from(scores.values()).reduce((a, b) => a + b, 0);

			render (
				<button onclick={() => scores.set('alice', 100)}>update</button>
				<span>{total}</span>
			);
		}

		mountComponent(MapTest);
		expect(container.querySelector('span').textContent).toBe('10');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('100');
	});

	it('reacts to Map.delete()', async () => {
		component MapDelete() {
			state scores = new Map([['a', 1], ['b', 2]]);
			derived size = scores.size;

			render (
				<button onclick={() => scores.delete('a')}>delete</button>
				<span>{size}</span>
			);
		}

		mountComponent(MapDelete);
		expect(container.querySelector('span').textContent).toBe('2');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('1');
	});
});

describe('reactivity > Set state', () => {
	it('reacts to Set.add()', async () => {
		component SetAdd() {
			state tags = new Set(['a', 'b']);
			derived count = tags.size;

			render (
				<button onclick={() => tags.add('c')}>add</button>
				<span>{count}</span>
			);
		}

		mountComponent(SetAdd);
		expect(container.querySelector('span').textContent).toBe('2');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('3');
	});

	it('reacts to Set.delete()', async () => {
		component SetDelete() {
			state tags = new Set([1, 2, 3]);
			derived count = tags.size;

			render (
				<button onclick={() => tags.delete(2)}>remove</button>
				<span>{count}</span>
			);
		}

		mountComponent(SetDelete);
		expect(container.querySelector('span').textContent).toBe('3');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('2');
	});
});

describe('reactivity > Date state', () => {
	it('reacts to Date setter methods', async () => {
		component DateTest() {
			state date = new Date(2020, 0, 1);
			derived year = date.getFullYear();

			render (
				<button onclick={() => date.setFullYear(2025)}>change year</button>
				<span>{year}</span>
			);
		}

		mountComponent(DateTest);
		expect(container.querySelector('span').textContent).toBe('2020');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('2025');
	});
});
