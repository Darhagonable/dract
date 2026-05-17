import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('component > anonymous-block', () => {
	it('renders anonymous block with local vars and render', () => {
		component Test() {
			render (
				<div>
					{
						const a = 'Hello';
						render <p>{a}</p>
					}
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('p')!.textContent).toBe('Hello');
	});

	it('renders anonymous block with reactive state', async () => {
		component Test() {
			state count = 0
			render (
				<div>
					{ const label = 'Count'; render <span>{label}: {count}</span> }
					<button onclick={count += 1}>inc</button>
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('span')!.textContent).toBe('Count: 0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('Count: 1');
	});

	it('renders multiple anonymous blocks', () => {
		component Test() {
			render (
				<div>
					{ const a = 'First'; render <p>{a}</p> }
					{ const b = 'Second'; render <span>{b}</span> }
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('p')!.textContent).toBe('First');
		expect(document.querySelector('span')!.textContent).toBe('Second');
	});

	it('renders block with local var and for loop', () => {
		component Test() {
			render (
				<ul>
					{
						const items = ['a', 'b', 'c']
						for (const item of items) (
							<li>{item}</li>
						)
					}
				</ul>
			);
		}

		mount(Test, document.body);
		const lis = document.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('a');
		expect(lis[1].textContent).toBe('b');
		expect(lis[2].textContent).toBe('c');
	});

	it('renders block with local var and if statement', () => {
		component Test() {
			render (
				<div>
					{
						const greeting = 'Hello'
						if (true) (
							<p>{greeting}</p>
						)
					}
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('p')!.textContent).toBe('Hello');
	});

	it('renders block with bare JSX (no render keyword)', () => {
		component Test() {
			render (
				<div>
					{ const x = 'bare'; render <span>{x}</span> }
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('span')!.textContent).toBe('bare');
	});
});
