import { describe, it, expect } from 'vitest';

describe('component > multiple root elements', () => {
	it('renders multiple root elements without wrapper', () => {
		component MultiRoot() {
			render (
				<header>Header</header>
				<main>Content</main>
				<footer>Footer</footer>
			);
		}

		mountComponent(MultiRoot);
		expect(container.querySelector('header').textContent).toBe('Header');
		expect(container.querySelector('main').textContent).toBe('Content');
		expect(container.querySelector('footer').textContent).toBe('Footer');
	});
});
