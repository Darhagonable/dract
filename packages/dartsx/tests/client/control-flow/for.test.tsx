import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('control-flow > for basic', () => {
	it('renders a list with for...of', () => {
		component ForBasic() {
			state items = [
				{ text: "Item 1" },
				{ text: "Item 2" },
				{ text: "Item 3" },
			];

			render (
				<ul>
					{for (const item of items) (
						<li>{item.text}</li>
					)}
				</ul>
			);
		}

		mountComponent(ForBasic);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('Item 1');
		expect(lis[1].textContent).toBe('Item 2');
		expect(lis[2].textContent).toBe('Item 3');
	});
});

describe('control-flow > for with index', () => {
	it('provides index variable in for...of loop', () => {
		component ForIndex() {
			state items = ['a', 'b', 'c'];

			render (
				<ul>
					{for (const item of items; index i) (
						<li>{i}: {item}</li>
					)}
				</ul>
			);
		}

		mountComponent(ForIndex);
		const lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('0: a');
		expect(lis[1].textContent).toBe('1: b');
		expect(lis[2].textContent).toBe('2: c');
	});
});

describe('control-flow > for with key', () => {
	it('uses key for efficient list updates', async () => {
		component ForKey() {
			state items = [
				{ id: 1, text: 'first' },
				{ id: 2, text: 'second' },
				{ id: 3, text: 'third' },
			];

			render (
				<button onclick={() => items.reverse()}>reverse</button>
				<ul>
					{for (const item of items; key item.id) (
						<li>{item.text}</li>
					)}
				</ul>
			);
		}

		mountComponent(ForKey);
		let lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('first');
		expect(lis[2].textContent).toBe('third');

		container.querySelector('button').click();
		await tick();

		lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('third');
		expect(lis[2].textContent).toBe('first');
	});
});

describe('control-flow > for with key and index (index first)', () => {
	it('provides both key and index with index first', async () => {
		component ForIndexKey() {
			state items = [
				{ id: 10, text: 'a' },
				{ id: 20, text: 'b' },
				{ id: 30, text: 'c' },
			];

			render (
				<button onclick={() => items.reverse()}>reverse</button>
				<ul>
					{for (const item of items; index i; key item.id) (
						<li>{i}: {item.text}</li>
					)}
				</ul>
			);
		}

		mountComponent(ForIndexKey);
		let lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('0: a');
		expect(lis[2].textContent).toBe('2: c');

		container.querySelector('button').click();
		await tick();

		lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('2: c');
		expect(lis[2].textContent).toBe('0: a');
	});
});

describe('control-flow > for with key and index (key first)', () => {
	it('provides both key and index with key first', async () => {
		component ForKeyIndex() {
			state items = [
				{ id: 10, text: 'x' },
				{ id: 20, text: 'y' },
				{ id: 30, text: 'z' },
			];

			render (
				<button onclick={() => items.reverse()}>reverse</button>
				<ul>
					{for (const item of items; key item.id; index i) (
						<li>{i}: {item.text}</li>
					)}
				</ul>
			);
		}

		mountComponent(ForKeyIndex);
		let lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('0: x');
		expect(lis[2].textContent).toBe('2: z');

		container.querySelector('button').click();
		await tick();

		lis = container.querySelectorAll('li');
		expect(lis[0].textContent).toBe('2: z');
		expect(lis[2].textContent).toBe('0: x');
	});
});

describe('control-flow > C-style for loop', () => {
	it('renders with a C-style for loop', () => {
		component CStyleFor() {
			state count = 3;

			render (
				<ul>
					{for (let i = 0; i < count; i++) (
						<li>{i}</li>
					)}
				</ul>
			);
		}

		mountComponent(CStyleFor);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('0');
		expect(lis[1].textContent).toBe('1');
		expect(lis[2].textContent).toBe('2');
	});
});

describe('control-flow > .map() expression', () => {
	it('renders list using .map()', () => {
		component MapList() {
			state items = ['a', 'b', 'c'];

			render (
				<ul>
					{items.map(item => <li>{item}</li>)}
				</ul>
			);
		}

		mountComponent(MapList);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('a');
	});
});

describe('control-flow > for-of with block render', () => {
	it('renders using local variables and render keyword', () => {
		component ForOfBlockRender() {
			state items = [
				{ name: "Alice" },
				{ name: "Bob" },
				{ name: "Charlie" },
			];

			render (
				<ul>
					{for (const item of items) {
						const name = item.name;
						render <li>{name}</li>
					}}
				</ul>
			);
		}

		mountComponent(ForOfBlockRender);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('Alice');
		expect(lis[1].textContent).toBe('Bob');
		expect(lis[2].textContent).toBe('Charlie');
	});
});

describe('control-flow > C-style for with block render', () => {
	it('renders using local variables in C-style for loop', () => {
		component CStyleBlockRender() {
			state count = 3;

			render (
				<ul>
					{for (let i = 0; i < count; i++) {
						const label = `item-${i}`;
						render <li>{label}</li>
					}}
				</ul>
			);
		}

		mountComponent(CStyleBlockRender);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('item-0');
		expect(lis[1].textContent).toBe('item-1');
		expect(lis[2].textContent).toBe('item-2');
	});
});
