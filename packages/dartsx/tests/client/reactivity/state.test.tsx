import { describe, it, expect } from 'vitest';
import { effect, tick, mount } from 'dartsx';

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

		mount(Counter, document.body);
		const btn = document.querySelector('button')!;
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

		mount(SameValue, document.body);
		expect(document.querySelector('span')!.textContent).toBe('5');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('5');
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

		mount(ProxyObj, document.body);
		expect(document.querySelector('span')!.textContent).toBe('Alice');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('Bob');
	});

	it('reacts to nested property mutations', async () => {
		component NestedProxy() {
			state data = { nested: { value: 'hello' } };

			render (
				<button onclick={() => data.nested.value = 'world'}>change</button>
				<span>{data.nested.value}</span>
			);
		}

		mount(NestedProxy, document.body);
		expect(document.querySelector('span')!.textContent).toBe('hello');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('world');
	});

	it('reacts to array push', async () => {
		component ArrayPush() {
			state items = ['a', 'b'];

			render (
				<button onclick={() => items.push('c')}>add</button>
				<span>{items.length}</span>
			);
		}

		mount(ArrayPush, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3');
	});

	it('reacts to array index mutation', async () => {
		component ArrayIndex() {
			state items = ['a', 'b', 'c'];

			render (
				<button onclick={() => items[0] = 'z'}>change</button>
				<span>{items[0]}</span>
			);
		}

		mount(ArrayIndex, document.body);
		expect(document.querySelector('span')!.textContent).toBe('a');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('z');
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

		mount(MapTest, document.body);
		expect(document.querySelector('span')!.textContent).toBe('10');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('100');
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

		mount(MapDelete, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');
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

		mount(SetAdd, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3');
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

		mount(SetDelete, document.body);
		expect(document.querySelector('span')!.textContent).toBe('3');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
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

		mount(DateTest, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2020');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2025');
	});
});
