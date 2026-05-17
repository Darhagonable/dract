import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';
import { count, increment } from './_store.ts';

describe('reactivity > cross-module', () => {
	it('reacts to state imported from another module', async () => {
		component CrossModuleApp() {
			render (
				<button onclick={() => increment()}>inc</button>
				<span>{count}</span>
			);
		}

		mount(CrossModuleApp, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
	});
});
