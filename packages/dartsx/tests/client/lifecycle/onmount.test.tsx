import { describe, it, expect } from 'vitest';
import { onMount, onCleanup, tick, mount } from 'dartsx';

describe('lifecycle > onMount', () => {
	it('calls onMount after component is in the DOM', async () => {
		component OnMountBasic() {
			state mounted = false;

			onMount(() => {
				mounted = true;
			});

			render (
				<p>{mounted ? 'Mounted' : 'Not mounted'}</p>
			);
		}

		mount(OnMountBasic, document.body);
		await tick();
		expect(document.querySelector('p')!.textContent).toBe('Mounted');
	});

	it('runs cleanup registered inside onMount on unmount', () => {
		let cleanedUp = false;

		component CleanupInMount() {
			onMount(() => {
				onCleanup(() => {
					cleanedUp = true;
				});
			});

			render (
				<p>test</p>
			);
		}

		const { unmount } = mount(CleanupInMount, document.body);
		expect(cleanedUp).toBe(false);

		unmount();
		expect(cleanedUp).toBe(true);
	});
});
