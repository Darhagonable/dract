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
					{for (const item of items) {
						<li>{item.text}</li>
					}}
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
					{for (const item of items; index i) {
						<li>{i}: {item}</li>
					}}
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
					{for (const item of items; key item.id) {
						<li>{item.text}</li>
					}}
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

describe('control-flow > C-style for loop', () => {
	it('renders with a C-style for loop', () => {
		component CStyleFor() {
			state count = 3;

			render (
				<ul>
					{for (let i = 0; i < count; i++) {
						<li>{i}</li>
					}}
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
