import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

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

		mount(CompositionApp, document.body);
		const buttons = document.querySelectorAll('button');
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

		mount(App, document.body);
		const card = document.querySelector('.card')!;
		expect(card.querySelector('h2')!.textContent).toBe('Title');
		expect(card.querySelector('p')!.textContent).toBe('Content');
	});
});

describe('component > reactive fragment return', () => {
	it('handles component that returns a reactive getter via fragment', async () => {
		component ReactiveContent() {
			state text = 'initial';

			render (
				<>{text}</>
			);
		}

		component Wrapper() {
			render (
				<div>
					<ReactiveContent />
				</div>
			);
		}

		mount(Wrapper, document.body);
		expect(document.querySelector('div')!.textContent).toBe('initial');
	});

	it('reactively updates when component returns function getter', async () => {
		state current = 'page-a';

		component ContentRenderer() {
			derived resolved = current ?? 'fallback';
			render (
				<>{resolved}</>
			);
		}

		component App() {
			render (
				<div id="out">
					<ContentRenderer />
				</div>
				<button onclick={() => current = 'page-b'}>nav</button>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('#out')!.textContent).toBe('page-a');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('#out')!.textContent).toBe('page-b');
	});

	it('swaps DOM nodes when component returns different elements', async () => {
		state which = 'home';

		function Home() {
			return document.createElement('h2');
		}

		component Switcher() {
			derived content = which === 'home'
				? (() => { const el = document.createElement('h2'); el.textContent = 'Home'; return el; })()
				: (() => { const el = document.createElement('h2'); el.textContent = 'About'; return el; })();

			render (
				<>{content}</>
			);
		}

		component App() {
			render (
				<div id="root">
					<Switcher />
				</div>
				<button onclick={() => which = 'about'}>go about</button>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('#root h2')!.textContent).toBe('Home');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('#root h2')!.textContent).toBe('About');
	});
});

describe('component > nested in factory function', () => {
	it('component inside factory function accesses parent state', async () => {
		function createCounter() {
			state count = 0;

			component Counter() {
				render (
					<button onclick={() => count++}>{count}</button>
				);
			}

			return Counter;
		}

		const Counter = createCounter();
		mount(Counter, document.body);
		expect(document.querySelector('button')!.textContent).toBe('0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.textContent).toBe('1');
	});

	it('component inside factory with derived from parent state', async () => {
		function createWidget() {
			state value = 5;
			derived doubled = value * 2;

			component Widget() {
				render (
					<div>
						<span class="v">{value}</span>
						<span class="d">{doubled}</span>
						<button onclick={() => value = 10}>set</button>
					</div>
				);
			}

			return Widget;
		}

		const Widget = createWidget();
		mount(Widget, document.body);
		expect(document.querySelector('.v')!.textContent).toBe('5');
		expect(document.querySelector('.d')!.textContent).toBe('10');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.v')!.textContent).toBe('10');
		expect(document.querySelector('.d')!.textContent).toBe('20');
	});
});
