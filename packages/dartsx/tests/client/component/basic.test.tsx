import { describe, it, expect } from 'vitest';
import { mount } from 'dartsx';

describe('component > basic', () => {
	it('renders a basic component', () => {
		component Greeting() {
			render (
				<h1>Hello, World!</h1>
			);
		}

		mount(Greeting, document.body);
		expect(document.querySelector('h1')!.textContent).toBe('Hello, World!');
	});
});
