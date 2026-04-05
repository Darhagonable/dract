import { describe, it, expect } from 'vitest';
import { onDestroy } from 'dartsx';

describe('lifecycle > onDestroy', () => {
	it('calls onDestroy when component is unmounted', async () => {
		let destroyed = false;

		component DestroyTest() {
			onDestroy(() => {
				destroyed = true;
			});

			render (
				<p>alive</p>
			);
		}

		const { unmount } = mountComponent(DestroyTest);
		expect(destroyed).toBe(false);
		expect(container.querySelector('p').textContent).toBe('alive');

		unmount();
		expect(destroyed).toBe(true);
	});

	it('runs multiple onDestroy callbacks in order', () => {
		const log: string[] = [];

		component MultiDestroy() {
			onDestroy(() => log.push('first'));
			onDestroy(() => log.push('second'));

			render (
				<p>test</p>
			);
		}

		const { unmount } = mountComponent(MultiDestroy);
		expect(log).toEqual([]);

		unmount();
		expect(log).toEqual(['first', 'second']);
	});
});
