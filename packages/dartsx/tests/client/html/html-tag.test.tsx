import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('html tag', () => {
	it('renders raw HTML into the DOM', () => {
		component Article() {
			render (
				<article>
					{@html "<p>hello <strong>world</strong></p>"}
				</article>
			)
		}

		mount(Article, document.body);
		expect(document.querySelector('article p')).not.toBeNull();
		expect(document.querySelector('article p')!.innerHTML).toBe('hello <strong>world</strong>');
	});

	it('renders empty string as nothing', () => {
		component Empty() {
			render (
				<div>
					{@html ""}
				</div>
			)
		}

		mount(Empty, document.body);
		const div = document.querySelector('div')!;
		// Should contain just the anchor comment
		expect(div.querySelector('p')).toBeNull();
	});

	it('updates reactively when expression changes', async () => {
		component Preview() {
			state markup = "<p>first</p>"

			render (
				<div>
					{@html markup}
					<button onclick={() => markup = "<p>second</p>"}>change</button>
				</div>
			)
		}

		mount(Preview, document.body);
		expect(document.querySelector('div p')!.textContent).toBe('first');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('div p')!.textContent).toBe('second');
	});

	it('does not execute script tags', () => {
		let executed = false;
		(globalThis as any).__html_test_exec = () => { executed = true; };

		component ScriptTest() {
			render (
				<div>
					{@html '<script>__html_test_exec()</script>'}
				</div>
			)
		}

		mount(ScriptTest, document.body);
		expect(executed).toBe(false);

		delete (globalThis as any).__html_test_exec;
	});
});
