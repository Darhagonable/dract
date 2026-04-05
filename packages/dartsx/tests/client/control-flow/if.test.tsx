import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('control-flow > if', () => {
	it('conditionally renders content', async () => {
		component IfBlock() {
			state x = true;

			render (
				<button onclick={() => x = !x}>toggle</button>
				{if (x) {
					<span>truthy</span>
				}}
			);
		}

		mountComponent(IfBlock);
		expect(container.querySelector('span').textContent).toBe('truthy');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span')).toBeNull();

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('truthy');
	});
});

describe('control-flow > if-else', () => {
	it('toggles between if and else branches', async () => {
		component IfElseBlock() {
			state x = true;

			render (
				<button onclick={() => x = !x}>toggle</button>
				{if (x) {
					<span>truthy</span>
				} else {
					<span>falsy</span>
				}}
			);
		}

		mountComponent(IfElseBlock);
		expect(container.querySelector('span').textContent).toBe('truthy');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('falsy');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('truthy');
	});
});

describe('control-flow > else-if', () => {
	it('cycles through else-if branches', async () => {
		component ElseIfBlock() {
			state mode = 'a'

			render (
				<button onclick={() => mode = mode === 'a' ? 'b' : mode === 'b' ? 'c' : 'a'}>cycle</button>
				{if (mode === 'a') {
					<span>A</span>
				} else if (mode === 'b') {
					<span>B</span>
				} else {
					<span>C</span>
				}}
			);
		}

		mountComponent(ElseIfBlock);
		expect(container.querySelector('span').textContent).toBe('A');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('B');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('C');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('A');
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

		mountComponent(TernaryTest);
		expect(container.querySelector('span').textContent).toBe('visible');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('hidden');
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

		mountComponent(LogicalAnd);
		expect(container.querySelector('span').textContent).toBe('shown');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span')).toBeNull();
	});
});
