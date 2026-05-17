import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('control-flow > if', () => {
	it('conditionally renders content', async () => {
		component IfBlock() {
			state x = true;

			render (
				<button onclick={() => x = !x}>toggle</button>
				{if (x) (
					<span>truthy</span>
				)}
			);
		}

		mount(IfBlock, document.body);
		expect(document.querySelector('span')!.textContent).toBe('truthy');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')).toBeNull();

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('truthy');
	});
});

describe('control-flow > if-else', () => {
	it('toggles between if and else branches', async () => {
		component IfElseBlock() {
			state x = true;

			render (
				<button onclick={() => x = !x}>toggle</button>
				{if (x) (
					<span>truthy</span>
				) else (
					<span>falsy</span>
				)}
			);
		}

		mount(IfElseBlock, document.body);
		expect(document.querySelector('span')!.textContent).toBe('truthy');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('falsy');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('truthy');
	});
});

describe('control-flow > else-if', () => {
	it('cycles through else-if branches', async () => {
		component ElseIfBlock() {
			state mode = 'a'

			render (
				<button onclick={() => mode = mode === 'a' ? 'b' : mode === 'b' ? 'c' : 'a'}>cycle</button>
				{if (mode === 'a') (
					<span>A</span>
				) else if (mode === 'b') (
					<span>B</span>
				) else (
					<span>C</span>
				)}
			);
		}

		mount(ElseIfBlock, document.body);
		expect(document.querySelector('span')!.textContent).toBe('A');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('B');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('C');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('A');
	});
});

describe('control-flow > ternary expression', () => {
	it('renders ternary in JSX', async () => {
		component TernaryTest() {
			state show = true;

			render (
				<button onclick={() => show = !show}>toggle</button>
				{show ? <span>visible</span> : <span>hidden</span>}
			);
		}

		mount(TernaryTest, document.body);
		expect(document.querySelector('span')!.textContent).toBe('visible');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('hidden');
	});
});

describe('control-flow > logical &&', () => {
	it('renders with logical AND', async () => {
		component LogicalAnd() {
			state show = true;

			render (
				<button onclick={() => show = !show}>toggle</button>
				{show && <span>shown</span>}
			);
		}

		mount(LogicalAnd, document.body);
		expect(document.querySelector('span')!.textContent).toBe('shown');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')).toBeNull();
	});
});

describe('control-flow > if with block render', () => {
	it('renders using local variables in if/else blocks', async () => {
		component IfBlockRender() {
			state show = true;

			render (
				<button onclick={() => show = !show}>toggle</button>
				{if (show) {
					const msg = 'visible';
					render <span>{msg}</span>
				} else {
					const msg = 'hidden';
					render <span>{msg}</span>
				}}
			);
		}

		mount(IfBlockRender, document.body);
		expect(document.querySelector('span')!.textContent).toBe('visible');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('hidden');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('visible');
	});
});

describe('control-flow > if bare expressions', () => {
	it('renders bare expressions in if-block branches', async () => {
		component App() {
			state count = 5;

			render (
				<button onclick={() => count = 0}>zero</button>
				<div>
						{if (count > 0) (
						count
					) else (
						0
					)}
				</div>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.textContent.trim()).toBe('5');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('div')!.textContent.trim()).toBe('0');
	});

	it('renders string expressions in if-block branches', async () => {
		component App() {
			state count = 0;

			render (
				<button onclick={() => count = 3}>set</button>
				<div>
					{if (count > 0) (
						"has items"
					) else (
						"no items"
					)}
				</div>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.textContent.trim()).toBe('no items');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('div')!.textContent.trim()).toBe('has items');
	});
});
