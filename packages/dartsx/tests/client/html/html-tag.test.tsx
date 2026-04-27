import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('html tag', () => {
	it('renders raw HTML into the DOM', () => {
		component Article() {
			render (
				<article>
					{@html "<p>hello <strong>world</strong></p>"}
				</article>
			)
		}

		mountComponent(Article);
		expect(container.querySelector('article p')).not.toBeNull();
		expect(container.querySelector('article p').innerHTML).toBe('hello <strong>world</strong>');
	});

	it('renders empty string as nothing', () => {
		component Empty() {
			render (
				<div>
					{@html ""}
				</div>
			)
		}

		mountComponent(Empty);
		const div = container.querySelector('div');
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

		mountComponent(Preview);
		expect(container.querySelector('div p').textContent).toBe('first');

		container.querySelector('button').click();
		await tick();
		expect(container.querySelector('div p').textContent).toBe('second');
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

		mountComponent(ScriptTest);
		expect(executed).toBe(false);

		delete (globalThis as any).__html_test_exec;
	});
});
