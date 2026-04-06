import { describe, it, expect } from 'vitest';
import { tick, createContext, provide } from 'dartsx';

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

		mountComponent(App);
		expect(container.querySelector('span').textContent).toBe('0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('1');
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

		mountComponent(App);
		expect(container.querySelector('span').textContent).toBe('off');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('on');
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

		mountComponent(Parent);
		expect(container.querySelector('button').textContent).toBe('Count: 0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('button').textContent).toBe('Count: 1');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('button').textContent).toBe('Count: 2');
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

		mountComponent(Parent);
		expect(container.querySelector('.name').textContent).toBe('');
		expect(container.querySelector('.email').textContent).toBe('');

		container.querySelector('.set-name').click();
		await tick();
		expect(container.querySelector('.name').textContent).toBe('Alice');

		container.querySelector('.set-email').click();
		await tick();
		expect(container.querySelector('.email').textContent).toBe('a@b.c');
	});
});
