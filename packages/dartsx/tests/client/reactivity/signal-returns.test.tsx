// Runtime behavior of signal returns: functions (and context factories)
// that return state/derived bindings hand the signals to consumers that
// opt in with `derived x = fn()`. Semantics:
// - destructured state-kind properties are two-way ($.prop.bind delegation)
// - destructured derived-kind properties are read-only deriveds
// - bag member writes on state-kind properties propagate through the setter
// - bag member writes on derived-kind properties are legal-but-inert
import { describe, it, expect, afterEach } from 'vitest';
import { tick, mount, createContext, provide } from 'dartsx';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('signal returns > bag through context', () => {
	it('derived ctx = {name, length}; return ctx — the canonical bag shape', async () => {
		const MyContext = createContext(() => {
			state name = 'default';
			derived length = name.length;
			derived ctx = { name, length };
			return ctx;
		});

		component Writer() {
			derived { name, length } = MyContext();
			render (
				<input bind:value={name} />
				<button onclick={() => (name = 'something new')}>write</button>
				<span class="len">{length}</span>
			);
		}

		component Reader() {
			derived ctx = MyContext();
			render (
				<p class="reader">{ctx.name}</p>
				<p class="reader-len">{ctx.length}</p>
			);
		}

		component Host() {
			provide(MyContext);
			render (<Writer /><Reader />);
		}

		mount(Host, document.body);
		await tick();
		const input = document.querySelector('input')!;
		expect(input.value).toBe('default');
		expect(document.querySelector('.len')!.textContent).toBe('7');
		expect(document.querySelector('.reader')!.textContent).toBe('default');
		expect(document.querySelector('.reader-len')!.textContent).toBe('7');

		// input → state → destructured + member consumers + derived length
		input.value = 'Bob';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(document.querySelector('.reader')!.textContent).toBe('Bob');
		expect(document.querySelector('.reader-len')!.textContent).toBe('3');
		expect(document.querySelector('.len')!.textContent).toBe('3');

		// destructured assignment write propagates everywhere
		(document.querySelector('button') as HTMLElement).click();
		await tick();
		expect(input.value).toBe('something new');
		expect(document.querySelector('.reader')!.textContent).toBe('something new');
		expect(document.querySelector('.len')!.textContent).toBe('13');
	});

	it('member writes through the bag propagate; derived member writes are inert', async () => {
		const MyContext = createContext(() => {
			state name = 'default';
			derived length = name.length;
			const ctx = { name, length };
			return ctx;
		});

		component Member() {
			derived ctx = MyContext();
			render (
				<p class="name">{ctx.name}</p>
				<p class="len">{ctx.length}</p>
				<button class="w" onclick={() => (ctx.name = 'via ctx')}>write</button>
				<button class="inert" onclick={() => (ctx.length = 3)}>inert</button>
			);
		}

		component Host() {
			provide(MyContext);
			render <Member />;
		}

		mount(Host, document.body);
		await tick();
		expect(document.querySelector('.name')!.textContent).toBe('default');

		// state-kind member write propagates
		(document.querySelector('.w') as HTMLElement).click();
		await tick();
		expect(document.querySelector('.name')!.textContent).toBe('via ctx');
		expect(document.querySelector('.len')!.textContent).toBe(String('via ctx'.length));

		// derived-kind member write: legal and inert — accepted, ignored,
		// the getter keeps recomputing from dependencies
		(document.querySelector('.inert') as HTMLElement).click();
		await tick();
		expect(document.querySelector('.len')!.textContent).toBe(String('via ctx'.length)); // still computed
	});

	it('const aliases are snapshots; derived aliases stay reactive', async () => {
		const MyContext = createContext(() => {
			state name = 'default';
			derived length = name.length;
			derived ctx = { name, length };
			return ctx;
		});

		component Aliased() {
			derived ctx = MyContext();
			const c2 = ctx; // plain const — snapshot semantics, never updates
			derived c3 = ctx; // derived alias — reactive
			render (
				<p class="snapshot">{c2.name}</p>
				<p class="live">{c3.name}</p>
				<button onclick={() => (ctx.name = 'aliased')}>write</button>
			);
		}

		component Host() {
			provide(MyContext);
			render <Aliased />;
		}

		mount(Host, document.body);
		await tick();
		expect(document.querySelector('.snapshot')!.textContent).toBe('default');
		expect(document.querySelector('.live')!.textContent).toBe('default');

		(document.querySelector('button') as HTMLElement).click();
		await tick();
		// const binding: captured once, never re-read
		expect(document.querySelector('.snapshot')!.textContent).toBe('default');
		// derived binding: reactive through the bag's getters
		expect(document.querySelector('.live')!.textContent).toBe('aliased');
	});
});

describe('signal returns > bare signal', () => {
	it('derived name = fn() binds the state raw — reads and writes hit the context', async () => {
		const NameContext = createContext((initialName: string) => {
			state name = initialName;
			return name;
		});

		component Form() {
			derived name = NameContext();
			render (
				<input bind:value={name} />
				<button onclick={() => (name = 'Alice')}>Reset</button>
			);
		}

		component Mirror() {
			derived name = NameContext();
			render <p class="mirror">{name}</p>;
		}

		component Host() {
			provide(NameContext, 'Alice');
			render (<Form /><Mirror />);
		}

		mount(Host, document.body);
		await tick();
		const input = document.querySelector('input')!;
		expect(input.value).toBe('Alice');
		expect(document.querySelector('.mirror')!.textContent).toBe('Alice');

		input.value = 'Bob';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(document.querySelector('.mirror')!.textContent).toBe('Bob');

		(document.querySelector('button') as HTMLElement).click();
		await tick();
		expect(input.value).toBe('Alice');
		expect(document.querySelector('.mirror')!.textContent).toBe('Alice');
	});

	it('plain const consumption keeps value semantics (no opt-in, no reactivity)', async () => {
		function makeLabel() {
			state label = 'plain';
			return label;
		}

		component Consumer() {
			const label = makeLabel();
			render <p>{label}</p>;
		}

		mount(Consumer, document.body);
		await tick();
		// const consumption compiled with value semantics: the return is
		// $.get-wrapped, so the binding holds the string, not a signal.
		expect(document.querySelector('p')!.textContent).toBe('plain');
	});
});
