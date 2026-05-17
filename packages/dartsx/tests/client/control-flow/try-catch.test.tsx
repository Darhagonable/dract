import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('control-flow > try catch', () => {
	it('catches errors and renders fallback', () => {
		function BrokenComponent() {
			throw new Error('boom');
		}

		component TryCatchBlock() {
			render (
				{try (
					<BrokenComponent />
				) catch (e) (
					<span>caught</span>
				)}
			);
		}

		mount(TryCatchBlock, document.body);
		expect(document.querySelector('span')!.textContent).toBe('caught');
	});
});

describe('control-flow > try pending catch', () => {
	it('shows pending content then resolves', async () => {
		function AsyncContent() {
			const span = document.createElement('span');
			span.textContent = 'done';
			return new Promise((resolve) => {
				setTimeout(() => resolve(span), 10);
			});
		}

		component TryPendingCatchBlock() {
			render (
				{try (
					<AsyncContent />
				) pending (
					<span>loading</span>
				) catch (e) (
					<span>error</span>
				)}
			);
		}

		mount(TryPendingCatchBlock, document.body);
		expect(document.querySelector('span')!.textContent).toBe('loading');

		await new Promise((r) => setTimeout(r, 50));
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('done');
	});
});

describe('control-flow > try catch with block render', () => {
	it('renders using local variables in catch block', () => {
		function BrokenComponent() {
			throw new Error('something broke');
		}

		component TryCatchBlockRender() {
			render (
				{try {
					<BrokenComponent />
				} catch (e) {
					const msg = e.message;
					render <span>{msg}</span>
				}}
			);
		}

		mount(TryCatchBlockRender, document.body);
		expect(document.querySelector('span')!.textContent).toBe('something broke');
	});
});
