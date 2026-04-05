import { describe, it, expect } from 'vitest';

describe('component > composition', () => {
	it('composes multiple child components', () => {
		component ComposableButton(label: string) {
			render (
				<button>{label}</button>
			);
		}

		component CompositionApp() {
			render (
				<ComposableButton label="Click me" />
				<ComposableButton label="Submit" />
			);
		}

		mountComponent(CompositionApp);
		const buttons = container.querySelectorAll('button');
		expect(buttons.length).toBe(2);
		expect(buttons[0].textContent).toBe('Click me');
		expect(buttons[1].textContent).toBe('Submit');
	});
});

describe('component > children', () => {
	it('renders children passed to component', () => {
		component Card(children) {
			render (
				<div class="card">
					{children}
				</div>
			);
		}

		component App() {
			render (
				<Card>
					<h2>Title</h2>
					<p>Content</p>
				</Card>
			);
		}

		mountComponent(App);
		const card = container.querySelector('.card');
		expect(card.querySelector('h2').textContent).toBe('Title');
		expect(card.querySelector('p').textContent).toBe('Content');
	});
});
