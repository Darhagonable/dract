import { describe, it, expect } from 'vitest';
import { mount } from 'dartsx';

describe('component > bare-jsx', () => {
	it('renders bare JSX inside expression braces', () => {
		component Test() {
			render (
				<div>
					{<p>Hello</p>}
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('p')!.textContent).toBe('Hello');
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

		mount(Test, document.body);
		expect(document.querySelector('p')!.textContent).toBe('One');
		expect(document.querySelector('span')!.textContent).toBe('Two');
	});

	it('renders nested bare JSX', () => {
		component Test() {
			render (
				<div>
					{<p><span>Nested</span></p>}
				</div>
			);
		}

		mount(Test, document.body);
		expect(document.querySelector('p span')!.textContent).toBe('Nested');
	});
});
