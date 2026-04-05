import { describe, it, expect } from 'vitest';

describe('component > basic', () => {
	it('renders a basic component', () => {
		component Greeting() {
			render (
				<h1>Hello, World!</h1>
			);
		}

		mountComponent(Greeting);
		expect(container.querySelector('h1').textContent).toBe('Hello, World!');
	});
});
