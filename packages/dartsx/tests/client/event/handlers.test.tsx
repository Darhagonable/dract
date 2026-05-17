import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('event > inline expression handler', () => {
	it('handles inline expression (count++)', async () => {
		component InlineHandler() {
			state count = 0;

			render (
				<button onclick={count++}>add</button>
				<span>{count}</span>
			);
		}

		mount(InlineHandler, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');
	});
});

describe('event > arrow function handler', () => {
	it('handles arrow function with argument', async () => {
		component ArrowHandler() {
			state message = '';

			function setMessage(msg: string) {
				message = msg;
			}

			render (
				<button onclick={() => setMessage('hello')}>greet</button>
				<span>{message}</span>
			);
		}

		mount(ArrowHandler, document.body);
		expect(document.querySelector('span')!.textContent).toBe('');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('hello');
	});
});

describe('event > method reference handler', () => {
	it('handles named function reference', async () => {
		component MethodHandler() {
			state count = 0;

			const increment = () => {
				count++;
			};

			render (
				<button onclick={increment}>add</button>
				<span>{count}</span>
			);
		}

		mount(MethodHandler, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');
	});
});

describe('event > multiple events on element', () => {
	it('handles multiple event types on one element', async () => {
		component MultiEvent() {
			state log = '';

			render (
				<button
					onclick={() => log = 'clicked'}
					onmouseenter={() => log = 'entered'}
				>hover or click</button>
				<span>{log}</span>
			);
		}

		mount(MultiEvent, document.body);

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('clicked');
	});
});
