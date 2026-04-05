import { describe, it, expect } from 'vitest';

describe('component > bare-jsx', () => {
	it('renders bare JSX inside expression braces', () => {
		component Test() {
			render (
				<div>
					{<p>Hello</p>}
				</div>
			);
		}

		mountComponent(Test);
		expect(container.querySelector('p').textContent).toBe('Hello');
	});

	it('renders multiple bare JSX elements', () => {
		component Test() {
			render (
				<div>
					{<p>One</p>}
					{<span>Two</span>}
				</div>
			);
		}

		mountComponent(Test);
		expect(container.querySelector('p').textContent).toBe('One');
		expect(container.querySelector('span').textContent).toBe('Two');
	});

	it('renders nested bare JSX', () => {
		component Test() {
			render (
				<div>
					{<p><span>Nested</span></p>}
				</div>
			);
		}

		mountComponent(Test);
		expect(container.querySelector('p span').textContent).toBe('Nested');
	});
});
