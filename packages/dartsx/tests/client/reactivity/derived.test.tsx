import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('reactivity > derived basic', () => {
	it('derives a value from state', async () => {
		component DerivedBasic() {
			state count = 2;
			derived doubled = count * 2;

			render (
				<button onclick={() => count++}>{count}</button>
				<p>{doubled}</p>
			);
		}

		mount(DerivedBasic, document.body);
		expect(document.querySelector('button')!.textContent).toBe('2');
		expect(document.querySelector('p')!.textContent).toBe('4');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.textContent).toBe('3');
		expect(document.querySelector('p')!.textContent).toBe('6');
	});

	it('chains multiple derived values', async () => {
		component DerivedChain() {
			state a = 2;
			derived b = a * 3;
			derived c = b + 1;

			render (
				<button onclick={() => a = 4}>change</button>
				<span class="b">{b}</span>
				<span class="c">{c}</span>
			);
		}

		mount(DerivedChain, document.body);
		expect(document.querySelector('.b')!.textContent).toBe('6');
		expect(document.querySelector('.c')!.textContent).toBe('7');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.b')!.textContent).toBe('12');
		expect(document.querySelector('.c')!.textContent).toBe('13');
	});

	it('derives from proxy state properties', async () => {
		component DerivedProxy() {
			state items = [1, 2, 3];
			derived total = items.reduce((a, b) => a + b, 0);

			render (
				<button onclick={() => items.push(4)}>add</button>
				<span>{total}</span>
			);
		}

		mount(DerivedProxy, document.body);
		expect(document.querySelector('span')!.textContent).toBe('6');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('10');
	});
});

describe('reactivity > derived skip propagation', () => {
	it('skips downstream updates when derived value unchanged', async () => {
		component SkipTest() {
			state count = 0;
			derived large = count > 10;

			render (
				<button onclick={() => count++}>inc</button>
				<span class="count">{count}</span>
				<span class="large">{large ? 'yes' : 'no'}</span>
			);
		}

		mount(SkipTest, document.body);
		expect(document.querySelector('.large')!.textContent).toBe('no');

		// Increment from 0 to 1 — large stays false
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.count')!.textContent).toBe('1');
		expect(document.querySelector('.large')!.textContent).toBe('no');
	});

	it('proxies object-valued derived results', async () => {
		const runtime = await import('dartsx/internal/client');
		const count = runtime.state(1);
		const counter = runtime.derived(() => ({ count: runtime.get(count) }));

		expect(runtime.isProxy(counter)).toBe(true);
		expect(counter.count).toBe(1);

		runtime.set(count, 2);

		expect(counter.count).toBe(2);
		expect(runtime.isProxy(runtime.get(counter))).toBe(true);
	});
});

describe('reactivity > derived object literal', () => {
	it('derives an object literal from state', async () => {
		component App() {
			state count = 1;
			derived obj = { count, doubled: count * 2 };

			render (
				<span class="c">{obj.count}</span>
				<span class="d">{obj.doubled}</span>
				<button onclick={() => count++}>inc</button>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('.c')!.textContent).toBe('1');
		expect(document.querySelector('.d')!.textContent).toBe('2');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.c')!.textContent).toBe('2');
		expect(document.querySelector('.d')!.textContent).toBe('4');
	});

	it('derives a module-level object literal from state', async () => {
		state x = 10;
		derived info = { value: x, label: 'test' };

		component Display() {
			render (
				<span class="v">{info.value}</span>
				<span class="l">{info.label}</span>
				<button onclick={() => x = 20}>set</button>
			);
		}

		mount(Display, document.body);
		expect(document.querySelector('.v')!.textContent).toBe('10');
		expect(document.querySelector('.l')!.textContent).toBe('test');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.v')!.textContent).toBe('20');
	});
});
