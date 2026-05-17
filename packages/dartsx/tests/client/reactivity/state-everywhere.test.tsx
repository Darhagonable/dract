import { describe, it, expect } from 'vitest';
import { tick, createContext, provide, mount } from 'dartsx';

describe('reactivity > state in non-component scopes', () => {
	it('state works inside a regular function', async () => {
		function createCounter() {
			state count = 0;
			const increment = () => count++;
			return { count, increment };
		}

		component App() {
			const counter = createCounter();
			derived count = counter.count;
			render (
				<div>
					<span>{count}</span>
					<button onclick={counter.increment}>+</button>
				</div>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');
	});

	it('state works inside an arrow function', async () => {
		const createToggle = () => {
			state active = false;
			const toggle = () => active = !active;
			return { active, toggle };
		};

		component App() {
			const t = createToggle();
			derived active = t.active;
			render (
				<div>
					<span>{active ? 'on' : 'off'}</span>
					<button onclick={t.toggle}>toggle</button>
				</div>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('off');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('on');
	});

	it('state works inside a createContext factory', async () => {
		const CounterCtx = createContext(() => {
			state count = 0;
			const increment = () => count++;
			return { count, increment };
		});

		component Parent() {
			provide(CounterCtx);
			render <Child />;
		}

		component Child() {
			derived { count, increment } = CounterCtx();
			render (
				<button onclick={increment}>Count: {count}</button>
			);
		}

		mount(Parent, document.body);
		expect(document.querySelector('button')!.textContent).toBe('Count: 0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.textContent).toBe('Count: 1');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.textContent).toBe('Count: 2');
	});

	it('derived destructuring tracks multiple reactive properties', async () => {
		const FormCtx = createContext(() => {
			state name = '';
			state email = '';
			const setName = (v: string) => name = v;
			const setEmail = (v: string) => email = v;
			return { name, email, setName, setEmail };
		});

		component Parent() {
			provide(FormCtx);
			render <Display />;
		}

		component Display() {
			derived { name, email, setName, setEmail } = FormCtx();
			render (
				<div>
					<span class="name">{name}</span>
					<span class="email">{email}</span>
					<button class="set-name" onclick={() => setName('Alice')}>name</button>
					<button class="set-email" onclick={() => setEmail('a@b.c')}>email</button>
				</div>
			);
		}

		mount(Parent, document.body);
		expect(document.querySelector('.name')!.textContent).toBe('');
		expect(document.querySelector('.email')!.textContent).toBe('');

		document.querySelector<HTMLElement>('.set-name')!.click();
		await tick();
		expect(document.querySelector('.name')!.textContent).toBe('Alice');

		document.querySelector<HTMLElement>('.set-email')!.click();
		await tick();
		expect(document.querySelector('.email')!.textContent).toBe('a@b.c');
	});
});
