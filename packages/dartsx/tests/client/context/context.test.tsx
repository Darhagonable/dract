import { describe, it, expect } from 'vitest';
import { createContext, provide, tick } from 'dartsx';

describe('context', () => {
	it('provides and consumes a simple value', () => {
		const MessageCtx = createContext(() => 'Hello!');

		component Parent() {
			provide(MessageCtx);
			render <Child />;
		}

		component Child() {
			const msg = MessageCtx();
			render <p>{msg}</p>;
		}

		mountComponent(Parent);
		expect(container.querySelector('p').textContent).toBe('Hello!');
	});

	it('throws when context is accessed outside provider scope', () => {
		const MissingCtx = createContext(() => 'nope');

		component Orphan() {
			const val = MissingCtx();
			render <p>{val}</p>;
		}

		expect(() => mountComponent(Orphan)).toThrow('Context was accessed outside of a provided scope');
	});

	it('scopes context to the provider subtree', () => {
		const ScopedCtx = createContext(() => 'scoped');

		component Provider() {
			provide(ScopedCtx);
			render <Consumer />;
		}

		component Consumer() {
			const val = ScopedCtx();
			render <span class="inside">{val}</span>;
		}

		component Outside() {
			const val = ScopedCtx();
			render <span class="outside">{val}</span>;
		}

		component App() {
			render (
				<div>
					<Provider />
					<Outside />
				</div>
			);
		}

		expect(() => mountComponent(App)).toThrow('Context was accessed outside of a provided scope');
	});

	it('provides a factory-created value through context', () => {
		const ConfigCtx = createContext(() => {
			return { theme: 'dark', lang: 'en' };
		});

		component Parent() {
			provide(ConfigCtx);
			render <Child />;
		}

		component Child() {
			const config = ConfigCtx();
			render (
				<p>{config.theme} / {config.lang}</p>
			);
		}

		mountComponent(Parent);
		expect(container.querySelector('p').textContent).toBe('dark / en');
	});

	it('provides context accessible by deeply nested children', () => {
		const ThemeCtx = createContext(() => 'dark');

		component Root() {
			provide(ThemeCtx);
			render <Middle />;
		}

		component Middle() {
			render <Leaf />;
		}

		component Leaf() {
			const theme = ThemeCtx();
			render <span>{theme}</span>;
		}

		mountComponent(Root);
		expect(container.querySelector('span').textContent).toBe('dark');
	});

	it('passes an argument from provide to the factory', () => {
		const GreetCtx = createContext((name: string) => `Hello, ${name}!`);

		component Parent() {
			provide(GreetCtx, 'Alice');
			render <Child />;
		}

		component Child() {
			const greeting = GreetCtx();
			render <p>{greeting}</p>;
		}

		mountComponent(Parent);
		expect(container.querySelector('p').textContent).toBe('Hello, Alice!');
	});

	it('provides and consumes in the same component', () => {
		const NameCtx = createContext(() => 'same-component');

		component Test() {
			provide(NameCtx);
			const val = NameCtx();
			render <p>{val}</p>;
		}

		mountComponent(Test);
		expect(container.querySelector('p').textContent).toBe('same-component');
	});

	it('consumes context inside a child block of the provider', () => {
		const NameCtx = createContext(() => ({ name: 'block-child' }));

		component Provider(children) {
			provide(NameCtx);
			render <div>{children}</div>;
		}

		component App() {
			render (
				<div>
					<Provider>
						{
							const ctx = NameCtx();
							render <p>{ctx.name}</p>
						}
					</Provider>
				</div>
			);
		}

		mountComponent(App);
		expect(container.querySelector('p').textContent).toBe('block-child');
	});

	it('provides reactive context with state and derived destructuring', async () => {
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
	});

	it('supports deep derived destructuring for nested objects and arrays', async () => {
		const NestedCtx = createContext(() => {
			state count = 0;
			state label = 'count-0';
			const increment = () => {
				count++;
				label = `count-${count}`;
			};

			return {
				get data() {
					return {
						counter: { 'count': count, 'increment': increment },
						values: [label, { 'count': count }],
					};
				},
			};
		});

		component Parent() {
			provide(NestedCtx);
			render <Child />;
		}

		component Child() {
			derived { data: { counter: { count, increment }, values: [label, { count: arrayCount }] } } = NestedCtx();
			render (
				<button onclick={increment}>{label}:{count}:{arrayCount}</button>
			);
		}

		mountComponent(Parent);
		expect(container.querySelector('button').textContent).toBe('count-0:0:0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('button').textContent).toBe('count-1:1:1');
	});

	it('supports derived defaults and object rest destructuring', async () => {
		const DefaultsCtx = createContext(() => {
			state role = 'reader';
			state currentName = undefined as string | undefined;

			return {
				get ['user']() {
					return { };
				},
				get ['role']() {
					return role;
				},
				get ['nameValue']() {
					return currentName;
				},
				version: 'v1',
				setAdmin() {
					role = 'admin';
					currentName = 'Alice';
				},
			};
		});

		component Parent() {
			provide(DefaultsCtx);
			render <Child />;
		}

		component Child() {
			derived { nameValue: profileName = 'anon', ...rest } = DefaultsCtx();
			render (
				<button onclick={rest.setAdmin}>{profileName}:{rest.role}:{rest.version}</button>
			);
		}

		mountComponent(Parent);
		expect(container.querySelector('button').textContent).toBe('anon:reader:v1');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('button').textContent).toBe('Alice:admin:v1');
	});

	it('supports derived defaults and array rest destructuring', async () => {
		const ArrayCtx = createContext(() => {
			state firstValue = undefined as string | undefined;
			state secondValue = 'beta';
			state thirdValue = 'gamma';
			const update = () => {
				firstValue = 'alpha';
				secondValue = 'delta';
				thirdValue = 'epsilon';
			};

			return {
				get list() {
					return [firstValue, secondValue, thirdValue];
				},
				update,
			};
		});

		component Parent() {
			provide(ArrayCtx);
			render <Child />;
		}

		component Child() {
			derived { list: [first = 'fallback', ...rest], update } = ArrayCtx();
			render (
				<button onclick={update}>{first}:{rest[0]}:{rest[1]}</button>
			);
		}

		mountComponent(Parent);
		expect(container.querySelector('button').textContent).toBe('fallback:beta:gamma');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('button').textContent).toBe('alpha:delta:epsilon');
	});
});
