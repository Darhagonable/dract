import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('component > render expression', () => {
	it('renders a static expression', () => {
		component Static() {
			render "hello"
		}

		mount(Static, document.body);
		expect(document.body.textContent).toBe('hello');
	});

	it('renders null', () => {
		component Nil() {
			render null
		}

		mount(Nil, document.body);
		expect(document.body.textContent).toBe('');
	});

	it('reactively updates when state changes', async () => {
		state count = 0;

		component Counter() {
			render count
		}

		mount(Counter, document.body);
		expect(document.body.textContent).toBe('0');

		count++;
		await tick();
		expect(document.body.textContent).toBe('1');

		count = 42;
		await tick();
		expect(document.body.textContent).toBe('42');
	});

	it('reactively updates proxy member access', async () => {
		state data = { label: 'initial' };

		component Label() {
			render data.label
		}

		mount(Label, document.body);
		expect(document.body.textContent).toBe('initial');

		data.label = 'updated';
		await tick();
		expect(document.body.textContent).toBe('updated');
	});

	it('reactively updates complex expression with nullish coalescing', async () => {
		state match: { name: string } | null = null;

		component Display() {
			render match?.name ?? "none"
		}

		mount(Display, document.body);
		expect(document.body.textContent).toBe('none');

		match = { name: 'home' };
		await tick();
		expect(document.body.textContent).toBe('home');

		match = null;
		await tick();
		expect(document.body.textContent).toBe('none');
	});
});
