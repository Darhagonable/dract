import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

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

		mountComponent(Test);
		expect(container.querySelector('p').textContent).toBe('Hello');
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

		mountComponent(Test);
		expect(container.querySelector('span').textContent).toBe('Count: 0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('Count: 1');
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

		mountComponent(Test);
		expect(container.querySelector('p').textContent).toBe('First');
		expect(container.querySelector('span').textContent).toBe('Second');
	});

	it('renders block with local var and for loop', () => {
		component Test() {
			render (
				<ul>
					{
						const items = ['a', 'b', 'c']
						for (const item of items) {
							<li>{item}</li>
						}
					}
				</ul>
			);
		}

		mountComponent(Test);
		const lis = container.querySelectorAll('li');
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
						if (true) {
							<p>{greeting}</p>
						}
					}
				</div>
			);
		}

		mountComponent(Test);
		expect(container.querySelector('p').textContent).toBe('Hello');
	});

	it('renders block with bare JSX (no render keyword)', () => {
		component Test() {
			render (
				<div>
					{ const x = 'bare'; <span>{x}</span> }
				</div>
			);
		}

		mountComponent(Test);
		expect(container.querySelector('span').textContent).toBe('bare');
	});
});
