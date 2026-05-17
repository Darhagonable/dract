import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('reactivity > bind proxy property', () => {
	it('two-way binds an input to a proxy property', async () => {
		component BindProxyForm() {
			state form = { name: "world" };

			render (
				<input bind:value={form.name} />
				<p>Hello {form.name}</p>
			);
		}

		mount(BindProxyForm, document.body);
		const input = document.querySelector('input')!;
		expect(input.value).toBe('world');

		input.value = 'DarTsx';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(document.querySelector('p')!.textContent).toBe('Hello DarTsx');
		expect(input.value).toBe('DarTsx');
	});
});

describe('reactivity > bind function', () => {
	it('uses getter/setter functions for bind:value', async () => {
		component BindFunctionApp() {
			state value = "Hello";

			render (
				<input bind:value={
					() => value,
					(v) => value = v.toUpperCase()
				} />
				<p>{value}</p>
			);
		}

		mount(BindFunctionApp, document.body);
		const input = document.querySelector('input')!;
		expect(input.value).toBe('Hello');

		input.value = 'world';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(document.querySelector('p')!.textContent).toBe('WORLD');
		expect(input.value).toBe('WORLD');
	});
});
