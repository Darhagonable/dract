import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('scoped CSS > data attribute injection', () => {
	it('adds data-scope attribute to all elements', () => {
		component Card() {
			render (
				<div>
					<h2>Title</h2>
					<p>Content</p>
				</div>
				<style>
					h2 { color: red; }
					p { font-size: 14px; }
				</style>
			)
		}

		mount(Card, document.body);
		const div = document.querySelector('div')!;
		const h2 = document.querySelector('h2')!;
		const p = document.querySelector('p')!;

		// All elements should have a data-scope attribute with a scope hash
		const hash = div.getAttribute('data-scope');
		expect(hash).toBeTruthy();
		expect(h2.getAttribute('data-scope')).toBe(hash);
		expect(p.getAttribute('data-scope')).toBe(hash);
	});

	it('adds data-scope to fragment roots', () => {
		component Multi() {
			render (
				<h1>Title</h1>
				<p>Subtitle</p>
				<style>
					h1 { font-size: 2em; }
				</style>
			)
		}

		mount(Multi, document.body);
		const h1 = document.querySelector('h1')!;
		const p = document.querySelector('p')!;

		const h1Hash = h1.getAttribute('data-scope');
		const pHash = p.getAttribute('data-scope');
		expect(h1Hash).toBeTruthy();
		expect(pHash).toBeTruthy();
		expect(h1Hash).toBe(pHash);
	});

	it('adds data-scope to elements inside control flow', async () => {
		component List() {
			state items = ['a', 'b']
			render (
				<ul>
					{for (const item of items) {
						render <li>{item}</li>
					}}
				</ul>
				<style>
					li { padding: 4px; }
				</style>
			)
		}

		mount(List, document.body);
		const lis = document.querySelectorAll('li');
		expect(lis.length).toBe(2);

		const ul = document.querySelector('ul')!;
		const hash = ul.getAttribute('data-scope');
		expect(hash).toBeTruthy();

		for (const li of lis) {
			expect(li.getAttribute('data-scope')).toBe(hash);
		}
	});
});

describe('scoped CSS > style injection', () => {
	it('injects a style element into head', () => {
		component Styled() {
			render (
				<div>Hello</div>
				<style>
					div { color: red; }
				</style>
			)
		}

		mount(Styled, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		expect(styles.length).toBeGreaterThanOrEqual(1);

		// The style should contain the scoped CSS with data-scope selector
		const styleTexts = [...styles].map(s => s.textContent);
		const hasScoped = styleTexts.some(t => t.includes('data-scope') && t.includes('color: red'));
		expect(hasScoped).toBe(true);
	});

	it('does not add data-scope for global style blocks', () => {
		component GlobalStyled() {
			render (
				<div>Hello</div>
				<style global>
					body { margin: 0; }
				</style>
			)
		}

		mount(GlobalStyled, document.body);
		const div = document.querySelector('div')!;
		expect(div.hasAttribute('data-scope')).toBe(false);
	});

	it('injects global styles without selector rewriting', () => {
		component GlobalOnly() {
			render (
				<div>Hello</div>
				<style global>
					.test-global { color: blue; }
				</style>
			)
		}

		mount(GlobalOnly, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		const hasGlobal = styleTexts.some(t => t.includes('.test-global { color: blue; }'));
		expect(hasGlobal).toBe(true);
	});
});

describe('scoped CSS > multiple components', () => {
	it('gives different components different scope hashes', () => {
		component CompA() {
			render (
				<div>A</div>
				<style>
					div { color: red; }
				</style>
			)
		}

		component CompB() {
			render (
				<div>B</div>
				<style>
					div { color: blue; }
				</style>
			)
		}

		// Mount A into its own container
		const divA = document.createElement('div');
		document.body.appendChild(divA);
		mount(CompA, divA);

		const attrA = divA.querySelector('div')?.getAttribute('data-scope');

		// Mount B into a separate container
		const divB = document.createElement('div');
		document.body.appendChild(divB);
		mount(CompB, divB);

		const attrB = divB.querySelector('div')?.getAttribute('data-scope');

		// Both should have scope attributes, and they should differ
		expect(attrA).toBeTruthy();
		expect(attrB).toBeTruthy();
		expect(attrA).not.toBe(attrB);
	});

	it('supports mixed scoped and global styles', () => {
		component MixedStyles() {
			render (
				<div>
					<p>Content</p>
				</div>
				<style>
					p { color: red; }
				</style>
				<style global>
					.global-class { display: block; }
				</style>
			)
		}

		mount(MixedStyles, document.body);

		// Scoped: div and p should have data-scope attribute
		const div = document.querySelector('div')!;
		const p = document.querySelector('p')!;
		const hash = div.getAttribute('data-scope');
		expect(hash).toBeTruthy();
		expect(p.getAttribute('data-scope')).toBe(hash);

		// Global style should be injected without scoping
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		const hasGlobal = styleTexts.some(t => t.includes('.global-class { display: block; }'));
		expect(hasGlobal).toBe(true);
	});
});

describe('scoped CSS > selector rewriting', () => {
	it('rewrites simple selectors with data attribute', () => {
		component Simple() {
			render (
				<p>Text</p>
				<style>
					p { color: green; }
				</style>
			)
		}

		mount(Simple, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		// Should have p[data-scope~="..."] not bare p
		const hasScopedP = styleTexts.some(t => /p\[data-scope~="?\w+"?\]/.test(t) && t.includes('color: green'));
		expect(hasScopedP).toBe(true);
	});

	it('rewrites @keyframes names with hash prefix', () => {
		component Animated() {
			render (
				<div>Anim</div>
				<style>
					@keyframes fadeIn {
						from { opacity: 0; }
						to { opacity: 1; }
					}
					div { animation: fadeIn 0.3s; }
				</style>
			)
		}

		mount(Animated, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		// @keyframes should be hash-prefixed
		const hasHashedKeyframes = styleTexts.some(t => /@keyframes \w+-fadeIn/.test(t));
		expect(hasHashedKeyframes).toBe(true);
		// animation property should reference the hashed name
		const hasHashedRef = styleTexts.some(t => /animation: \w+-fadeIn/.test(t));
		expect(hasHashedRef).toBe(true);
	});

	it('rewrites selectors inside @media queries', () => {
		component Responsive() {
			render (
				<div><p>Content</p></div>
				<style>
					@media (max-width: 768px) {
						p { font-size: 12px; }
					}
				</style>
			)
		}

		mount(Responsive, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		const hasScopedMedia = styleTexts.some(t =>
			t.includes('@media') && /p\[data-scope~="?\w+"?\]/.test(t)
		);
		expect(hasScopedMedia).toBe(true);
	});

	it('handles :deep() by scoping before and unscoping after', () => {
		component DeepTest() {
			render (
				<div>
					<span>Inner</span>
				</div>
				<style>
					div :deep(.child) { color: red; }
				</style>
			)
		}

		mount(DeepTest, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		// Should have div[data-scope~="..."] .child (no attr on .child)
		const hasDeep = styleTexts.some(t =>
			/div\[data-scope~="?\w+"?\]\s+\.child/.test(t)
		);
		expect(hasDeep).toBe(true);
	});

	it('handles :global() by emitting unscoped selector', () => {
		component GlobalSelector() {
			render (
				<p>Text</p>
				<style>
					p { color: red; }
					:global(body) { margin: 0; }
				</style>
			)
		}

		mount(GlobalSelector, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		// :global(body) → bare body selector
		const hasGlobalBody = styleTexts.some(t => t.includes('body { margin: 0; }') && !t.includes('body[data-scope'));
		expect(hasGlobalBody).toBe(true);
		// p should still be scoped
		const hasScopedP = styleTexts.some(t => /p\[data-scope~="?\w+"?\]/.test(t));
		expect(hasScopedP).toBe(true);
	});
});

describe('scoped CSS > children / slots', () => {
	it('adds scope attributes to children passed to other components', () => {
		component Wrapper(children) {
			render <div>{children}</div>
		}

		component Parent() {
			render (
				<Wrapper>
					<p>Slotted content</p>
				</Wrapper>
				<style>
					p { color: red; }
				</style>
			)
		}

		mount(Parent, document.body);
		const p = document.querySelector('p')!;
		// The <p> was authored by Parent so it should have Parent's scope hash
		expect(p.getAttribute('data-scope')).toBeTruthy();
	});
});

describe('scoped CSS > nested style blocks', () => {
	it('applies outer scope to all elements and inner scope only to nested subtree', () => {
		component Nested() {
			render (
				<div>
					<p>Outside</p>
					<div>
						<p>Inside</p>
						<style>
							p { color: green; }
						</style>
					</div>
				</div>
				<style>
					p { color: red; }
				</style>
			)
		}

		mount(Nested, document.body);
		const divs = document.querySelectorAll('div');
		// divs[0] is the outer div, divs[1] is the inner div
		const outerDiv = divs[0];
		const innerDiv = divs[1];
		const allP = document.querySelectorAll('p');
		const outerP = allP[0]; // "Outside"
		const innerP = allP[1]; // "Inside"

		// Collect scope hashes from data-scope (space-separated)
		const outerDivHashes = (outerDiv.getAttribute('data-scope') || '').split(/\s+/).filter(Boolean);
		const innerDivHashes = (innerDiv.getAttribute('data-scope') || '').split(/\s+/).filter(Boolean);
		const outerPHashes = (outerP.getAttribute('data-scope') || '').split(/\s+/).filter(Boolean);
		const innerPHashes = (innerP.getAttribute('data-scope') || '').split(/\s+/).filter(Boolean);

		// Outer div has only the outer scope hash
		expect(outerDivHashes.length).toBe(1);

		// Inner div has both outer and inner scope hashes
		expect(innerDivHashes.length).toBe(2);

		// Outer p has only the outer scope hash
		expect(outerPHashes.length).toBe(1);
		expect(outerPHashes[0]).toBe(outerDivHashes[0]);

		// Inner p has both scope hashes
		expect(innerPHashes.length).toBe(2);
	});
});

describe('scoped CSS > reactive CSS values', () => {
	it('sets CSS custom properties on the component root element', () => {
		component Themed() {
			state color = 'red'
			render (
				<div>Themed</div>
				<style>
					div { color: {color}; }
				</style>
			)
		}

		mount(Themed, document.body);
		const div = document.querySelector('div')!;
		// CSS var should be on the component's root element (per-instance, like Vue)
		expect(div.style.cssText).toContain('red');
	});

	it('updates CSS custom properties reactively', async () => {
		component ReactiveTheme() {
			state size = 16
			render (
				<button onclick={() => size = 24}>Grow</button>
				<style>
					button { font-size: {size}px; }
				</style>
			)
		}

		mount(ReactiveTheme, document.body);
		const button = document.querySelector('button')!;
		// Initial value — css var on component root
		expect(button.style.cssText).toContain('16px');

		// Click to update
		button.click();
		await tick();
		expect(button.style.cssText).toContain('24px');
	});

	it('replaces expressions with var() references in injected CSS', () => {
		component VarRef() {
			state color = 'blue'
			render (
				<p>Text</p>
				<style>
					p { color: {color}; }
				</style>
			)
		}

		mount(VarRef, document.body);
		const styles = document.head.querySelectorAll('style[data-dartsx]');
		const styleTexts = [...styles].map(s => s.textContent);
		// Should contain var(--color) not the literal expression
		const hasVar = styleTexts.some(t => /var\(--[a-z][\w-]*\)/.test(t));
		expect(hasVar).toBe(true);
	});
});
