import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';
import { count, increment } from './_store.ts';

describe('reactivity > cross-module', () => {
	it('reacts to state imported from another module', async () => {
		component CrossModuleApp() {
			render (
				<button onclick={() => increment()}>inc</button>
				<span>{count}</span>
			);
		}

		mountComponent(CrossModuleApp);
		expect(container.querySelector('span').textContent).toBe('0');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('1');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('2');
	});
});
