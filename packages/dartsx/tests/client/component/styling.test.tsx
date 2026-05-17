import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('styling > class attribute', () => {
	it('accepts a plain string', () => {
		component App() {
			render <div class="card active">hello</div>;
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.className).toBe('card active');
	});

	it('accepts an object with truthy/falsy values', () => {
		component App() {
			render <div class={{ alert: true, hidden: false, primary: true }}>hello</div>;
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.className).toBe('alert primary');
	});

	it('accepts an array of strings and falsy values', () => {
		component App() {
			render <div class={['btn', false && 'hidden', 'active', null, undefined]}>hello</div>;
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.className).toBe('btn active');
	});

	it('accepts mixed arrays with objects', () => {
		component App() {
			render <div class={['card', { highlighted: true, disabled: false }]}>hello</div>;
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.className).toBe('card highlighted');
	});

	it('reactively updates class', async () => {
		component App() {
			state isActive = false;
			render <button class={{ btn: true, active: isActive }} onclick={() => isActive = true}>click</button>;
		}

		mount(App, document.body);
		expect(document.querySelector('button')!.className).toBe('btn');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.className).toBe('btn active');
	});

	it('removes class attribute when resolved to empty', () => {
		component App() {
			render <div class={{ hidden: false }}>hello</div>;
		}

		mount(App, document.body);
		expect(document.querySelector('div')!.hasAttribute('class')).toBe(false);
	});
});

describe('styling > style attribute', () => {
	it('accepts an object with camelCase properties', () => {
		component App() {
			render <div style={{ color: 'red', fontSize: '14px' }}>hello</div>;
		}

		mount(App, document.body);
		const style = document.querySelector('div')!.style;
		expect(style.color).toBe('red');
		expect(style.fontSize).toBe('14px');
	});

	it('auto-appends px to numeric values', () => {
		component App() {
			render <div style={{ width: 200, padding: 16 }}>hello</div>;
		}

		mount(App, document.body);
		const style = document.querySelector('div')!.style;
		expect(style.width).toBe('200px');
		expect(style.padding).toBe('16px');
	});

	it('does not append px to unitless properties', () => {
		component App() {
			render <div style={{ opacity: 0.5, zIndex: 10, lineHeight: 1.5 }}>hello</div>;
		}

		mount(App, document.body);
		const style = document.querySelector('div')!.style;
		expect(style.opacity).toBe('0.5');
		expect(style.zIndex).toBe('10');
		expect(style.lineHeight).toBe('1.5');
	});

	it('reactively updates style', async () => {
		component App() {
			state color = 'blue';
			render <button style={{ color }} onclick={() => color = 'red'}>click</button>;
		}

		mount(App, document.body);
		expect(document.querySelector('button')!.style.color).toBe('blue');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.style.color).toBe('red');
	});

	it('handles vendor prefixes via camelCase', () => {
		component App() {
			render <div style={{ WebkitTransform: 'rotate(45deg)' }}>hello</div>;
		}

		mount(App, document.body);
		// jsdom stores it as webkitTransform or -webkit-transform depending on version
		const div = document.querySelector('div')!;
		const raw = div.getAttribute('style') || div.style.cssText;
		expect(raw).toContain('rotate(45deg)');
	});

	it('supports CSS custom properties', () => {
		component App() {
			render <div style={{ '--brand-color': 'coral', '--spacing': '8px' }}>hello</div>;
		}

		mount(App, document.body);
		const div = document.querySelector('div')!;
		expect(div.style.getPropertyValue('--brand-color')).toBe('coral');
		expect(div.style.getPropertyValue('--spacing')).toBe('8px');
	});
});
