import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('lifecycle > tick', () => {
	it('resolves after state changes flush', async () => {
		component TickTest() {
			state count = 0;

			render (
				<button onclick={() => count++}>inc</button>
				<span>{count}</span>
			);
		}

		mountComponent(TickTest);
		container.querySelector('button').click();

		// Before tick, DOM may not be updated yet
		await tick();
		// After tick, DOM should be updated
		expect(container.querySelector('span').textContent).toBe('1');
	});

	it('resolves immediately when no changes pending', async () => {
		const before = Date.now();
		await tick();
		const elapsed = Date.now() - before;
		expect(elapsed).toBeLessThan(50);
	});
});
