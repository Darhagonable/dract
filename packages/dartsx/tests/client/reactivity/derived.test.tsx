import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

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

		mountComponent(DerivedBasic);
		expect(container.querySelector('button').textContent).toBe('2');
		expect(container.querySelector('p').textContent).toBe('4');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('button').textContent).toBe('3');
		expect(container.querySelector('p').textContent).toBe('6');
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

		mountComponent(DerivedChain);
		expect(container.querySelector('.b').textContent).toBe('6');
		expect(container.querySelector('.c').textContent).toBe('7');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('.b').textContent).toBe('12');
		expect(container.querySelector('.c').textContent).toBe('13');
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

		mountComponent(DerivedProxy);
		expect(container.querySelector('span').textContent).toBe('6');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('10');
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

		mountComponent(SkipTest);
		expect(container.querySelector('.large').textContent).toBe('no');

		// Increment from 0 to 1 — large stays false
		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('.count').textContent).toBe('1');
		expect(container.querySelector('.large').textContent).toBe('no');
	});
});
