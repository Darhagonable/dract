import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('component > bind-proxy-member', () => {
	it('two-way binds a proxy member through a child component', async () => {
		component BindChild(bind name) {
			render (
				<input bind:value={name} />
			);
		}

		component BindProxyMemberApp() {
			state form = { name: "world" };

			render (
				<BindChild bind:name={form.name} />
				<p>Hello {form.name}</p>
			);
		}

		mount(BindProxyMemberApp, document.body);
		const input = document.querySelector('input')!;
		expect(input.value).toBe('world');

		input.value = 'DarTsx';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(document.querySelector('p')!.textContent).toBe('Hello DarTsx');
	});
});

describe('component > bind-renamed-prop', () => {
	it('two-way binds a renamed prop', async () => {
		component BindRenamedChild(bind 'display-name' as displayName: string) {
			render (
				<input bind:value={displayName} />
			)
		}

		component BindRenamedApp() {
			state form = { name: "world" }

			render (
				<BindRenamedChild bind:display-name={form.name} />
				<p>Hello {form.name}</p>
			)
		}

		mount(BindRenamedApp, document.body);
		const input = document.querySelector('input')!;
		expect(input.value).toBe('world');

		input.value = 'DarTsx';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		expect(document.querySelector('p')!.textContent).toBe('Hello DarTsx');
	});
});
