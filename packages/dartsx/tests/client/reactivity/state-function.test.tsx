import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('reactivity > state with function object', () => {
	it('reacts to property mutations on a function with Object.assign', async () => {
		function greet() {
			return 'hello';
		}

		component App() {
			state fn = Object.assign(greet, { count: 0 });
			render (
				<button onclick={() => fn.count++}>inc</button>
				<span class="count">{fn.count}</span>
				<span class="call">{fn()}</span>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('.count')!.textContent).toBe('0');
		expect(document.querySelector('.call')!.textContent).toBe('hello');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.count')!.textContent).toBe('1');
	});

	it('function state remains callable after state proxy wrapping', async () => {
		let callCount = 0;

		function action() {
			callCount++;
			return callCount;
		}

		component App() {
			state fn = Object.assign(action, { label: 'go' });
			render (
				<button onclick={() => fn()}>call</button>
				<span class="label">{fn.label}</span>
				<span class="calls">{callCount}</span>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('.label')!.textContent).toBe('go');

		document.querySelector('button')!.click();
		await tick();
		expect(callCount).toBe(1);
	});

	it('derived tracks reactive properties on function state', async () => {
		function execute() {
			return 'executed';
		}

		component App() {
			state fn = Object.assign(execute, {
				data: undefined as string | undefined,
				loading: false,
			});

			render (
				<button onclick={() => { fn.loading = true; fn.data = fn(); fn.loading = false; }}>run</button>
				<span class="data">{fn.data ?? 'none'}</span>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('.data')!.textContent).toBe('none');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.data')!.textContent).toBe('executed');
	});
});
