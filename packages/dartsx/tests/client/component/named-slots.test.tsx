import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

// Named slots: element-valued props must render through plain interpolation
// (`{header}`) — no invocation, no stringified thunks. This pins the
// preprocessor bug where a nested JSX attribute's `=` (e.g. `class="..."`)
// false-positived the assignment-attr heuristic and rewrote the prop into an
// arrow thunk that rendered as function source text.

describe('component > named slots', () => {
	it('renders a static element prop with attributes', () => {
		component SlottedCard(header: any) {
			render (
				<div class="card">
					<div class="card-head">{header}</div>
				</div>
			);
		}

		component SlotApp() {
			render (
				<SlottedCard header={<h2 class="title">Hello</h2>} />
			);
		}

		mount(SlotApp, document.body);
		const head = document.querySelector('.card-head')!;
		expect(head.querySelector('h2.title')!.textContent).toBe('Hello');
	});

	it('renders fragment props and props whose elements carry handlers', () => {
		component Panel(tools: any) {
			render (
				<div class="panel">{tools}</div>
			);
		}

		component PanelApp() {
			render (
				<Panel
					tools={
						<>
							<button class="btn" onclick={() => {}}>a</button>
							, and text with commas
						</>
					}
				/>
			);
		}

		mount(PanelApp, document.body);
		const panel = document.querySelector('.panel')!;
		expect(panel.querySelector('button.btn')).toBeTruthy();
		expect(panel.textContent).toContain('text with commas');
	});

	it('swaps a reactive element prop when state changes', async () => {
		component Frame(tab: any) {
			render (
				<div class="frame">{tab}</div>
			);
		}

		component ReactiveSlotApp() {
			state on = true;

			render (
				<div>
					<button class="toggle" onclick={() => (on = !on)}>toggle</button>
					<Frame tab={on ? <span class="yes">on</span> : <span class="no">off</span>} />
				</div>
			);
		}

		mount(ReactiveSlotApp, document.body);
		expect(document.querySelector('.frame span')!.className).toBe('yes');

		(document.querySelector('.toggle') as HTMLElement).click();
		await tick();
		expect(document.querySelector('.frame span')!.className).toBe('no');

		(document.querySelector('.toggle') as HTMLElement).click();
		await tick();
		expect(document.querySelector('.frame span')!.className).toBe('yes');
	});

	it('binds refs inside slot elements', async () => {
		component HostMount(children: any) {
			render (
				<section class="host">{children}</section>
			);
		}

		let mounted: HTMLElement | undefined;
		component RefSlotApp() {
			render (
				<HostMount>
					<div class="inner" bind:this={mounted} />
				</HostMount>
			);
		}

		mount(RefSlotApp, document.body);
		await tick();
		expect(mounted).toBeTruthy();
		expect(document.querySelector('section.host .inner')).toBe(mounted);
	});
});
