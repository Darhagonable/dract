import { describe, it, expect, vi } from 'vitest';
import { tick } from 'dartsx';
import { defineQuery, useQuery } from '../src/index';

function flush() {
	return new Promise<void>((r) => setTimeout(r, 0));
}

describe('useQuery', () => {
	it('fetches and renders data', async () => {
		let resolve: (val: { id: number; title: string }) => void;
		const postQuery = defineQuery(vi.fn((id: number) => new Promise<{ id: number; title: string }>((r) => { resolve = r; })));

		component App() {
			derived post = useQuery(postQuery(1));
			render (
				<p class="loading">{post.loading ? 'yes' : 'no'}</p>
				<p class="data">{post.data?.title ?? ''}</p>
			);
		}

		mountComponent(App);
		await tick();
		expect(container.querySelector('.loading').textContent).toBe('yes');
		expect(container.querySelector('.data').textContent).toBe('');

		resolve!({ id: 1, title: 'Post 1' });
		await flush();
		await tick();
		expect(container.querySelector('.loading').textContent).toBe('no');
		expect(container.querySelector('.data').textContent).toBe('Post 1');
	});

	it('renders error state', async () => {
		const err = new Error('network fail');
		const onError = vi.fn();
		const postQuery = defineQuery<() => Promise<never>, Error>(vi.fn(async () => { throw err; }));

		component App() {
			derived post = useQuery(postQuery(), { onError });
			render (
				<p class="error">{post.error?.message ?? ''}</p>
				<p class="success">{post.success ? 'yes' : 'no'}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();

		expect(container.querySelector('.error').textContent).toBe('network fail');
		expect(container.querySelector('.success').textContent).toBe('no');
		expect(onError).toHaveBeenCalledWith(err);
	});

	it('does not fetch when disabled', async () => {
		const fetcher = vi.fn(async () => 'data');
		const postQuery = defineQuery(fetcher);

		component App() {
			derived post = useQuery(false && postQuery());
			render (
				<p class="loading">{post.loading ? 'yes' : 'no'}</p>
				<p class="data">{post.data ?? 'empty'}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();

		expect(fetcher).not.toHaveBeenCalled();
		expect(container.querySelector('.loading').textContent).toBe('no');
		expect(container.querySelector('.data').textContent).toBe('empty');
	});

	it('re-fetches when reactive args change', async () => {
		const fetcher = vi.fn(async (id: number) => `item-${id}`);
		const postQuery = defineQuery(fetcher);

		component App() {
			state id = 1;
			derived post = useQuery(postQuery(id));
			render (
				<button onclick={() => id++}>next</button>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('item-1');

		container.querySelector('button').click();
		await tick();
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('item-2');

		container.querySelector('button').click();
		await tick();
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('item-3');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('uses cache for previously fetched args', async () => {
		const fetcher = vi.fn(async (id: number) => `post-${id}`);
		const postQuery = defineQuery(fetcher);

		component App() {
			state id = 1;
			derived post = useQuery(postQuery(id));
			render (
				<button onclick={() => id = id === 1 ? 2 : 1}>toggle</button>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('post-1');

		container.querySelector('button').click();
		await tick();
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('post-2');
		expect(fetcher).toHaveBeenCalledTimes(2);

		// Switch back — serves cached data, but refetches
		container.querySelector('button').click();
		await tick();
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('post-1');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('invalidate triggers re-fetch', async () => {
		let counter = 0;
		const fetcher = vi.fn(async () => `v${++counter}`);
		const postQuery = defineQuery(fetcher);

		component App() {
			derived post = useQuery(postQuery());
			render (
				<button onclick={() => postQuery.invalidate()}>invalidate</button>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('v1');

		container.querySelector('button').click();
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('v2');
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('refetch updates data', async () => {
		let counter = 0;
		const fetcher = vi.fn(async () => `v${++counter}`);
		const postQuery = defineQuery(fetcher);

		component App() {
			derived post = useQuery(postQuery());
			render (
				<button onclick={() => post.refetch()}>refetch</button>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('v1');

		container.querySelector('button').click();
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('v2');
	});

	it('clear removes cache', async () => {
		const fetcher = vi.fn(async () => 'data');
		const postQuery = defineQuery(fetcher);

		component App() {
			state show = true;
			derived post = show ? useQuery(postQuery()) : { data: 'gone' };
			render (
				<button onclick={() => { postQuery.clear(); show = false; }}>clear</button>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(fetcher).toHaveBeenCalledTimes(1);

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('gone');

		// Remount — should re-fetch
		component App2() {
			derived post = useQuery(postQuery());
			render <p class="data">{post.data ?? ''}</p>;
		}

		mountComponent(App2);
		await flush();
		await tick();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('renders null data as success', async () => {
		const postQuery = defineQuery(vi.fn(async () => null));

		component App() {
			derived post = useQuery(postQuery());
			render (
				<p class="success">{post.success ? 'yes' : 'no'}</p>
				<p class="data">{post.data === null ? 'null' : 'other'}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.success').textContent).toBe('yes');
		expect(container.querySelector('.data').textContent).toBe('null');
	});

	it('recovers from error on re-fetch', async () => {
		let shouldFail = true;
		const postQuery = defineQuery<() => Promise<string>, Error>(vi.fn(async () => {
			if (shouldFail) throw new Error('fail');
			return 'ok';
		}));

		component App() {
			derived post = useQuery(postQuery());
			render (
				<button onclick={() => { shouldFail = false; post.refetch(); }}>retry</button>
				<p class="error">{post.error?.message ?? ''}</p>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.error').textContent).toBe('fail');

		container.querySelector('button').click();
		await flush();
		await tick();
		expect(container.querySelector('.error').textContent).toBe('');
		expect(container.querySelector('.data').textContent).toBe('ok');
	});

	it('discards stale response after invalidate', async () => {
		const resolvers: Array<(val: string) => void> = [];
		const postQuery = defineQuery(vi.fn(() => new Promise<string>((resolve) => {
			resolvers.push(resolve);
		})));

		component App() {
			derived post = useQuery(postQuery());
			render (
				<button onclick={() => postQuery.invalidate()}>invalidate</button>
				<p class="loading">{post.loading ? 'yes' : 'no'}</p>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(container.querySelector('.loading').textContent).toBe('yes');

		// Invalidate while first fetch is in-flight
		container.querySelector('button').click();
		await flush();
		await tick();
		expect(resolvers).toHaveLength(2);

		// Resolve stale first response
		resolvers[0]!('stale');
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('');
		expect(container.querySelector('.loading').textContent).toBe('yes');

		// Resolve second (current) response
		resolvers[1]!('fresh');
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('fresh');
		expect(container.querySelector('.loading').textContent).toBe('no');
	});

	it('deduplicates fetches across multiple components', async () => {
		const fetcher = vi.fn(async () => 'shared');
		const postQuery = defineQuery(fetcher);

		component Child() {
			derived post = useQuery(postQuery());
			render <p class="child">{post.data ?? ''}</p>;
		}

		component App() {
			derived post = useQuery(postQuery());
			render (
				<p class="parent">{post.data ?? ''}</p>
				<Child />
			);
		}

		mountComponent(App);
		await flush();
		await tick();

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(container.querySelector('.parent').textContent).toBe('shared');
		expect(container.querySelector('.child').textContent).toBe('shared');
	});

	it('refetchInterval polls periodically', async () => {
		vi.useFakeTimers();
		let counter = 0;
		const fetcher = vi.fn(async () => `v${++counter}`);
		const postQuery = defineQuery(fetcher);

		component App() {
			derived post = useQuery(postQuery(), { refetchInterval: 1000 });
			render <p class="data">{post.data ?? ''}</p>;
		}

		mountComponent(App);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(container.querySelector('.data').textContent).toBe('v1');

		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(container.querySelector('.data').textContent).toBe('v2');

		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(container.querySelector('.data').textContent).toBe('v3');

		vi.useRealTimers();
	});

	it('aborts previous fetch on invalidate', async () => {
		const signals: AbortSignal[] = [];
		const resolvers: Array<(val: string) => void> = [];
		const postQuery = defineQuery(vi.fn((...args: unknown[]) => {
			const signal = args[args.length - 1] as AbortSignal;
			signals.push(signal);
			return new Promise<string>((resolve) => { resolvers.push(resolve); });
		}));

		component App() {
			derived post = useQuery(postQuery());
			render (
				<button onclick={() => postQuery.invalidate()}>invalidate</button>
				<p class="data">{post.data ?? ''}</p>
			);
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(signals).toHaveLength(1);
		expect(signals[0].aborted).toBe(false);

		container.querySelector('button').click();
		await flush();
		await tick();
		expect(signals).toHaveLength(2);
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);

		resolvers[1]!('fresh');
		await flush();
		await tick();
		expect(container.querySelector('.data').textContent).toBe('fresh');
	});

	it('passes signal to queryFn', async () => {
		let receivedSignal: AbortSignal | undefined;
		const postQuery = defineQuery(vi.fn(async (id: number, signal: AbortSignal) => {
			receivedSignal = signal;
			return `item-${id}`;
		}));

		component App() {
			derived post = useQuery(postQuery(1));
			render <p class="data">{post.data ?? ''}</p>;
		}

		mountComponent(App);
		await flush();
		await tick();
		expect(receivedSignal).toBeInstanceOf(AbortSignal);
		expect(receivedSignal!.aborted).toBe(false);
		expect(container.querySelector('.data').textContent).toBe('item-1');
	});
});
