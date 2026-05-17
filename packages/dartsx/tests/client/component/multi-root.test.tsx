import { describe, it, expect } from 'vitest';
import { mount } from 'dartsx';

describe('component > multiple root elements', () => {
	it('renders multiple root elements without wrapper', () => {
		component MultiRoot() {
			render (
				<header>Header</header>
				<main>Content</main>
				<footer>Footer</footer>
			);
		}

		mount(MultiRoot, document.body);
		expect(document.querySelector('header')!.textContent).toBe('Header');
		expect(document.querySelector('main')!.textContent).toBe('Content');
		expect(document.querySelector('footer')!.textContent).toBe('Footer');
	});
});
