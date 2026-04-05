import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('control-flow > switch basic', () => {
	it('switches between branches', async () => {
		component SwitchBasic() {
			state mode = 'a'

			render (
				<button onclick={() => mode = mode === 'a' ? 'b' : 'a'}>toggle</button>
				{switch (mode) {
					case 'a':
						<span>Mode A</span>
						break;
					case 'b':
						<span>Mode B</span>
						break;
					default:
						<span>Unknown</span>
				}}
			);
		}

		mountComponent(SwitchBasic);
		expect(container.querySelector('span').textContent).toBe('Mode A');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('Mode B');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('Mode A');
	});
});

describe('control-flow > switch fall-through', () => {
	it('handles switch case fall-through', async () => {
		component SwitchFallThrough() {
			state mode = 'init';

			render (
				<button onclick={() => mode = mode === 'init' ? 'loading' : 'init'}>toggle</button>
				{switch (mode) {
					case 'init':
					case 'loading':
						<span>Loading...</span>
						break;
					case 'done':
						<span>Done!</span>
						break;
					default:
						<span>Unknown</span>
				}}
			);
		}

		mountComponent(SwitchFallThrough);
		expect(container.querySelector('span').textContent).toBe('Loading...');

		container.querySelector('button').click();
		await tick();
		// 'loading' also falls into the Loading case
		expect(container.querySelector('span').textContent).toBe('Loading...');
	});
});

describe('control-flow > switch with block render', () => {
	it('renders using local variables in switch cases', async () => {
		component SwitchBlockRender() {
			state mode = 'a';

			render (
				<button onclick={() => mode = mode === 'a' ? 'b' : 'a'}>toggle</button>
				{switch (mode) {
					case 'a':
						const aLabel = 'Alpha';
						render <span>{aLabel}</span>
					case 'b':
						const bLabel = 'Beta';
						render <span>{bLabel}</span>
				}}
			);
		}

		mountComponent(SwitchBlockRender);
		expect(container.querySelector('span').textContent).toBe('Alpha');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('span').textContent).toBe('Beta');
	});
});
