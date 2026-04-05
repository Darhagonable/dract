import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('binding > bind:checked', () => {
	it('two-way binds a checkbox', async () => {
		component CheckboxTest() {
			state accepted = false;

			render (
				<input type="checkbox" bind:checked={accepted} />
				<span>{accepted ? 'yes' : 'no'}</span>
			);
		}

		mountComponent(CheckboxTest);
		const input = container.querySelector('input');
		expect(input.checked).toBe(false);
		expect(container.querySelector('span').textContent).toBe('no');

		input.checked = true;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();

		expect(container.querySelector('span').textContent).toBe('yes');
	});
});

describe('binding > bind:value numeric', () => {
	it('coerces number input value to number', async () => {
		component NumericInput() {
			state num = 0;
			derived doubled = num * 2;

			render (
				<input type="number" bind:value={num} />
				<span>{doubled}</span>
			);
		}

		mountComponent(NumericInput);
		const input = container.querySelector('input');

		input.value = '5';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(container.querySelector('span').textContent).toBe('10');
	});
});

describe('binding > bind:value select', () => {
	it('binds to a select element', async () => {
		component SelectTest() {
			state selected = 'a';

			render (
				<select bind:value={selected}>
					<option value="a">A</option>
					<option value="b">B</option>
					<option value="c">C</option>
				</select>
				<span>{selected}</span>
			);
		}

		mountComponent(SelectTest);
		const select = container.querySelector('select');
		expect(select.value).toBe('a');
		expect(container.querySelector('span').textContent).toBe('a');

		select.value = 'c';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();

		expect(container.querySelector('span').textContent).toBe('c');
	});
});

describe('binding > bind:value textarea', () => {
	it('two-way binds a textarea', async () => {
		component TextareaTest() {
			state text = 'hello';

			render (
				<textarea bind:value={text} />
				<p>{text}</p>
			);
		}

		mountComponent(TextareaTest);
		const textarea = container.querySelector('textarea');
		expect(textarea.value).toBe('hello');

		textarea.value = 'world';
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(container.querySelector('p').textContent).toBe('world');
	});
});

describe('binding > bind function with null getter', () => {
	it('supports readonly binding with null getter', async () => {
		// Stub ResizeObserver for jsdom
		const origRO = globalThis.ResizeObserver;
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as any;

		component ReadonlyBind() {
			state width = 0;

			render (
				<div class="box" bind:clientWidth={null, (w) => width = w}>content</div>
				<span>{width}</span>
			);
		}

		// Just verify it compiles and mounts without error
		mountComponent(ReadonlyBind);
		expect(container.querySelector('.box')).not.toBeNull();

		globalThis.ResizeObserver = origRO;
	});
});

describe('binding > bind:{x} shorthand', () => {
	it('expands bind:{x} to bind:value={x}', async () => {
		component ShorthandBind() {
			state name = 'alice';

			render (
				<input bind:{name} />
				<span>{name}</span>
			);
		}

		mountComponent(ShorthandBind);
		const input = container.querySelector('input');
		expect(input.value).toBe('alice');

		input.value = 'bob';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(container.querySelector('span').textContent).toBe('bob');
	});
});
