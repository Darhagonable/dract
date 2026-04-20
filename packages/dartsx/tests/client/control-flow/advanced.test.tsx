import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

describe('control-flow > for with nested if', () => {
	it('renders conditional content inside a for loop', async () => {
		component ForWithIf() {
			state items = [
				{ text: 'apple', highlight: true },
				{ text: 'banana', highlight: false },
				{ text: 'cherry', highlight: true },
			];

			render (
				<ul>
					{for (const item of items) {
						render (
							<li>
								{item.text}
								{if (item.highlight) {
									<strong> ★</strong>
								}}
							</li>
						)
					}}
				</ul>
			);
		}

		mountComponent(ForWithIf);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('apple ★');
		expect(lis[1].textContent).toContain('banana');
		expect(lis[1].querySelector('strong')).toBeNull();
		expect(lis[2].textContent).toBe('cherry ★');
	});
});

describe('control-flow > for with nested if-else', () => {
	it('renders if-else branches inside a for loop', async () => {
		component ForWithIfElse() {
			state items = [
				{ text: 'admin', role: 'admin' },
				{ text: 'guest', role: 'guest' },
				{ text: 'mod', role: 'admin' },
			];

			render (
				<ul>
					{for (const item of items) {
						render (
							<li>
								{item.text}:
								{if (item.role === 'admin') {
									<span class="badge">Admin</span>
								} else {
									<span class="badge">User</span>
								}}
							</li>
						)
					}}
				</ul>
			);
		}

		mountComponent(ForWithIfElse);
		const lis = container.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].querySelector('.badge').textContent).toBe('Admin');
		expect(lis[1].querySelector('.badge').textContent).toBe('User');
		expect(lis[2].querySelector('.badge').textContent).toBe('Admin');
	});
});

describe('control-flow > nested for loops', () => {
	it('renders nested for loops (groups with children)', () => {
		component NestedFor() {
			state groups = [
				{ name: 'Fruits', children: ['Apple', 'Banana'] },
				{ name: 'Vegs', children: ['Carrot', 'Pea'] },
			];

			render (
				<div>
					{for (const group of groups) {
						render (
							<section>
								<h2>{group.name}</h2>
								<ul>
									{for (const child of group.children) {
										render ( <li>{child}</li> )
									}}
								</ul>
							</section>
						)
					}}
				</div>
			);
		}

		mountComponent(NestedFor);
		const sections = container.querySelectorAll('section');
		expect(sections.length).toBe(2);

		expect(sections[0].querySelector('h2').textContent).toBe('Fruits');
		const fruitsLis = sections[0].querySelectorAll('li');
		expect(fruitsLis.length).toBe(2);
		expect(fruitsLis[0].textContent).toBe('Apple');
		expect(fruitsLis[1].textContent).toBe('Banana');

		expect(sections[1].querySelector('h2').textContent).toBe('Vegs');
		const vegsLis = sections[1].querySelectorAll('li');
		expect(vegsLis.length).toBe(2);
		expect(vegsLis[0].textContent).toBe('Carrot');
		expect(vegsLis[1].textContent).toBe('Pea');
	});
});

describe('control-flow > nested for with conditional children', () => {
	it('renders nested for + if to conditionally show children', () => {
		component NestedForIf() {
			state groups = [
				{ name: 'Fruits', children: ['Apple', 'Banana'] },
				{ name: 'Empty', children: [] },
				{ name: 'Vegs', children: ['Carrot'] },
			];

			render (
				<ol>
					{for (const group of groups) {
						<li>
							{group.name}
							{if (group.children.length > 0) {
								<ol>
									{for (const child of group.children) {
										render ( <li>{child}</li> )
									}}
								</ol>
							}}
						</li>
					}}
				</ol>
			);
		}

		mountComponent(NestedForIf);
		const topLis = container.querySelectorAll(':scope > ol > li');
		expect(topLis.length).toBe(3);

		// Fruits — has nested <ol>
		expect(topLis[0].textContent).toContain('Fruits');
		const fruitOl = topLis[0].querySelector('ol');
		expect(fruitOl).not.toBeNull();
		expect(fruitOl.querySelectorAll('li').length).toBe(2);

		// Empty — no nested <ol>
		expect(topLis[1].textContent).toContain('Empty');
		expect(topLis[1].querySelector('ol')).toBeNull();

		// Vegs — has nested <ol>
		expect(topLis[2].textContent).toContain('Vegs');
		const vegOl = topLis[2].querySelector('ol');
		expect(vegOl).not.toBeNull();
		expect(vegOl.querySelectorAll('li').length).toBe(1);
	});
});

describe('control-flow > for with switch inside', () => {
	it('renders switch cases inside a for loop', () => {
		component ForWithSwitch() {
			state items = [
				{ type: 'header', text: 'Title' },
				{ type: 'paragraph', text: 'Hello world' },
				{ type: 'header', text: 'Subtitle' },
			];

			render (
				<div>
					{for (const item of items) {
						render (
							{switch (item.type) {
								case 'header':
									<h2>{item.text}</h2>
									break;
								case 'paragraph':
									<p>{item.text}</p>
									break;
								default:
									<span>{item.text}</span>
							}}
						)
					}}
				</div>
			);
		}

		mountComponent(ForWithSwitch);
		const h2s = container.querySelectorAll('h2');
		const ps = container.querySelectorAll('p');
		expect(h2s.length).toBe(2);
		expect(ps.length).toBe(1);
		expect(h2s[0].textContent).toBe('Title');
		expect(ps[0].textContent).toBe('Hello world');
		expect(h2s[1].textContent).toBe('Subtitle');
	});
});

describe('control-flow > reactive nested for + if', () => {
	it('updates nested for/if when state changes', async () => {
		component ReactiveNestedForIf() {
			state groups = [
				{ name: 'A', children: ['a1', 'a2'] },
				{ name: 'B', children: [] },
			];

			render (
				<button onclick={() => groups = [
					{ name: 'A', children: ['a1', 'a2'] },
					{ name: 'B', children: ['b1'] },
					{ name: 'C', children: ['c1', 'c2', 'c3'] },
				]}>update</button>
				<div>
					{for (const group of groups) {
						render (
							<section>
								<h3>{group.name}</h3>
								{if (group.children.length > 0) {
									<ul>
										{for (const child of group.children) {
											render ( <li>{child}</li> )
										}}
									</ul>
								} else {
									<p>empty</p>
								}}
							</section>
						)
					}}
				</div>
			);
		}

		mountComponent(ReactiveNestedForIf);

		let sections = container.querySelectorAll('section');
		expect(sections.length).toBe(2);
		expect(sections[0].querySelectorAll('li').length).toBe(2);
		expect(sections[1].querySelector('p').textContent).toBe('empty');

		container.querySelector('button').click();
		await tick();

		sections = container.querySelectorAll('section');
		expect(sections.length).toBe(3);
		expect(sections[1].querySelectorAll('li').length).toBe(1);
		expect(sections[1].querySelector('p')).toBeNull();
		expect(sections[2].querySelectorAll('li').length).toBe(3);
	});
});
