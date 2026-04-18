import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('component > render expression', () => {
	it('renders a static expression', () => {
		component Static() {
			render "hello"
		}

		mountComponent(Static);
		expect(container.textContent).toBe('hello');
	});

	it('renders null', () => {
		component Nil() {
			render null
		}

		mountComponent(Nil);
		expect(container.textContent).toBe('');
	});

	it('reactively updates when state changes', async () => {
		state count = 0;

		component Counter() {
			render count
		}

		mountComponent(Counter);
		expect(container.textContent).toBe('0');

		count++;
		await tick();
		expect(container.textContent).toBe('1');

		count = 42;
		await tick();
		expect(container.textContent).toBe('42');
	});

	it('reactively updates proxy member access', async () => {
		state data = { label: 'initial' };

		component Label() {
			render data.label
		}

		mountComponent(Label);
		expect(container.textContent).toBe('initial');

		data.label = 'updated';
		await tick();
		expect(container.textContent).toBe('updated');
	});

	it('reactively updates complex expression with nullish coalescing', async () => {
		state match: { name: string } | null = null;

		component Display() {
			render match?.name ?? "none"
		}

		mountComponent(Display);
		expect(container.textContent).toBe('none');

		match = { name: 'home' };
		await tick();
		expect(container.textContent).toBe('home');

		match = null;
		await tick();
		expect(container.textContent).toBe('none');
	});
});
