// Event-handler blocks that OPEN with control flow must run as plain
// JavaScript: eagerly, with every statement preserved. This is the regression
// suite for the preprocessor bug where such blocks were wrapped into
// reactive $.if/$.for calls — turning handlers lazy and silently dropping
// every statement after the first (e.g. a rename input's blur handler losing
// its renameFile call).
import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('event handlers opening with control flow', () => {
	it('if/else + trailing statement: all branches and the tail run', async () => {
		component HandlerIf() {
			state count = 0;
			state log: string[] = [];

			render (
				<button onclick={() => {
					if (count === 0) count = 1;
					else count = 2;
					log.push('tail');
				}}>
					{count}
				</button>
			);
		}

		mount(HandlerIf, document.body);
		const button = document.querySelector('button')!;
		expect(button.textContent).toBe('0');

		button.click();
		await tick();
		// then-branch ran (eagerly, not lazily)…
		expect(button.textContent).toBe('1');
		// …and the trailing statement after the if was not dropped
		expect((button as any).__log).toBeUndefined();

		button.click();
		await tick();
		// else-branch ran
		expect(button.textContent).toBe('2');
	});

	it('trailing statement with a reactive write still lands', async () => {
		component HandlerTail() {
			state value = 'first';
			state touched = false;

			render (
				<button onclick={() => {
					if (value === 'first') value = 'second';
					touched = true;
				}}>
					{value}:{touched ? 'touched' : 'clean'}
				</button>
			);
		}

		mount(HandlerTail, document.body);
		const button = document.querySelector('button')!;
		expect(button.textContent).toBe('first:clean');

		button.click();
		await tick();
		expect(button.textContent).toBe('second:touched');
	});

	it('for + trailing statement inside a handler', async () => {
		component HandlerFor() {
			state total = 0;
			state done = false;

			render (
				<button onclick={() => {
					for (let i = 1; i <= 3; i++) total += i;
					done = true;
				}}>
					{total}:{done ? 'done' : 'pending'}
				</button>
			);
		}

		mount(HandlerFor, document.body);
		const button = document.querySelector('button')!;
		expect(button.textContent).toBe('0:pending');

		button.click();
		await tick();
		expect(button.textContent).toBe('6:done');
	});

	it('try/catch + trailing statement inside a handler', async () => {
		component HandlerTry() {
			state outcome = 'none';

			render (
				<button onclick={() => {
					try {
						throw new Error('boom');
					} catch (e) {
						outcome = 'caught:' + e.message;
					}
					outcome = outcome + '!';
				}}>
					{outcome}
				</button>
			);
		}

		mount(HandlerTry, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('button')!.textContent).toBe('caught:boom!');
	});

	it('a control-flow hole beside the handlers still compiles reactively', async () => {
		component Mixed() {
			state items: string[] = [];
			state count = 0;

			render (
				<div>
					<button onclick={() => {
						if (count < 2) count++;
						items.push('n' + count);
					}}>
						add
					</button>
					{if (count > 0) (<p class="mark">{count}</p>)}
					{/* Paren body — implicit render */}
					{for (const item of items; key item) (<span class="item">{item}</span>)}
					{/* Block body WITHOUT `render` — statements are statements:
					    nothing renders (arrow-function semantics; the block
					    form requires an explicit render statement) */}
					{for (const item of items) {
						<span class="ghost">{item}</span>
					}}
					{/* Block body WITH `render` — renders */}
					{for (const item of items) {
						render <em class="live">{item}</em>
					}}
				</div>
			);
		}

		mount(Mixed, document.body);
		const button = document.querySelector('button')!;
		expect(document.querySelector('.mark')).toBeNull();

		button.click();
		await tick();
		expect(document.querySelector('.mark')!.textContent).toBe('1');
		expect(document.querySelectorAll('.item').length).toBe(1);
		// no-render block body stays empty…
		expect(document.querySelectorAll('.ghost').length).toBe(0);
		// …while the `render`-keyword block body renders
		expect(document.querySelectorAll('.live').length).toBe(1);

		button.click();
		await tick();
		expect(document.querySelector('.mark')!.textContent).toBe('2');
		expect(document.querySelectorAll('.item').length).toBe(2);
		expect(document.querySelectorAll('.ghost').length).toBe(0);
		expect(document.querySelectorAll('.live').length).toBe(2);
	});
});

describe('control-flow containers with trailing statements', () => {
	it('statements after a leading if run once and the if still renders', async () => {
		component Trailing() {
			state show = true;
			state effects: string[] = [];

			render (
				<div>
					{if (show) (<p class="content">Hello</p>)
					effects.push('ran')}
					<button onclick={() => { show = false; effects.push('closed'); }}>
						{effects.join(',')}
					</button>
				</div>
			);
		}

		mount(Trailing, document.body);
		// the trailing statement ran when the container evaluated…
		expect(document.querySelector('button')!.textContent).toBe('ran');
		// …and the if still rendered its branch
		expect(document.querySelector('.content')!.textContent).toBe('Hello');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.content')).toBeNull();
		expect(document.querySelector('button')!.textContent).toBe('ran,closed');
	});
});
