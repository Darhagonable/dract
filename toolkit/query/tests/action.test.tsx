import { afterEach, describe, it, expect, vi } from 'vitest';

afterEach(() => {
	document.body.innerHTML = '';
});
import { tick, mount } from 'dartsx';
import { defineAction, useAction } from '../src/index';

function flush() {
	return new Promise<void>((r) => setTimeout(r, 0));
}

describe('useAction', () => {
	it('executes and renders result', async () => {
		let resolve: (val: { id: number; title: string }) => void;
		const createPostAction = defineAction(vi.fn((title: string) => new Promise<{ id: number; title: string }>((r) => { resolve = r; })));

		component App() {
			derived createPost = useAction(createPostAction);
			render (
				<button onclick={() => createPost('Hello')}>go</button>
				<p class="loading">{createPost.loading ? 'yes' : 'no'}</p>
				<p class="data">{createPost.data?.title ?? ''}</p>
			);
		}

		mount(App, document.body);
		await tick();
		expect(document.querySelector('.loading')!.textContent).toBe('no');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.loading')!.textContent).toBe('yes');

		resolve!({ id: 1, title: 'Hello' });
		await flush();
		await tick();
		expect(document.querySelector('.loading')!.textContent).toBe('no');
		expect(document.querySelector('.data')!.textContent).toBe('Hello');
	});

	it('renders error state', async () => {
		const onError = vi.fn();
		const createPostAction = defineAction<() => Promise<never>, Error>(vi.fn(async () => { throw new Error('fail'); }));

		component App() {
			derived createPost = useAction(createPostAction, { onError });
			render (
				<button onclick={() => createPost().catch(() => {})}>go</button>
				<p class="error">{createPost.error?.message ?? ''}</p>
			);
		}

		mount(App, document.body);
		await tick();

		document.querySelector('button')!.click();
		await flush();
		await tick();

		expect(document.querySelector('.error')!.textContent).toBe('fail');
		expect(onError).toHaveBeenCalled();
	});

	it('reset clears state', async () => {
		const createPostAction = defineAction(vi.fn(async () => 'data'));

		component App() {
			derived createPost = useAction(createPostAction);
			render (
				<button class="go" onclick={() => createPost()}>go</button>
				<button class="reset" onclick={() => createPost.reset()}>reset</button>
				<p class="success">{createPost.success ? 'yes' : 'no'}</p>
				<p class="data">{createPost.data ?? ''}</p>
			);
		}

		mount(App, document.body);
		await tick();

		document.querySelector<HTMLElement>('.go')!.click();
		await flush();
		await tick();
		expect(document.querySelector('.success')!.textContent).toBe('yes');
		expect(document.querySelector('.data')!.textContent).toBe('data');

		document.querySelector<HTMLElement>('.reset')!.click();
		await tick();
		expect(document.querySelector('.success')!.textContent).toBe('no');
		expect(document.querySelector('.data')!.textContent).toBe('');
	});

	it('sequential calls — latest wins', async () => {
		let callCount = 0;
		const createPostAction = defineAction(vi.fn(async () => {
			const n = ++callCount;
			await new Promise((r) => setTimeout(r, n === 1 ? 50 : 10));
			return `result-${n}`;
		}));

		component App() {
			derived createPost = useAction(createPostAction);
			render (
				<button onclick={() => { createPost(); createPost(); }}>go</button>
				<p class="data">{createPost.data ?? ''}</p>
			);
		}

		mount(App, document.body);
		await tick();

		document.querySelector('button')!.click();
		await new Promise((r) => setTimeout(r, 100));
		await tick();
		expect(document.querySelector('.data')!.textContent).toBe('result-2');
	});
});
