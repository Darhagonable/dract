import { describe, it, expect } from 'vitest';
import { effect, onCleanup, tick, mount } from 'dartsx';

// ─── Primitive state ───────────────────────────────────────────────

describe('state > primitive > number', () => {
	it('renders initial value', () => {
		component App() {
			state n = 42;
			render <span>{n}</span>;
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('42');
	});

	it('updates on assignment', async () => {
		component App() {
			state n = 0;
			render (
				<button onclick={() => n = 10}>set</button>
				<span>{n}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('10');
	});

	it('updates on increment (++)', async () => {
		component App() {
			state n = 0;
			render (
				<button onclick={() => n++}>inc</button>
				<span>{n}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
	});

	it('updates on compound assignment (+=)', async () => {
		component App() {
			state n = 5;
			render (
				<button onclick={() => n += 3}>add</button>
				<span>{n}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('8');
	});

	it('does not update DOM when value unchanged', async () => {
		component App() {
			state n = 7;
			render (
				<button onclick={() => n = 7}>same</button>
				<span>{n}</span>
			);
		}
		mount(App, document.body);
		const span = document.querySelector('span')!;
		const initial = span.textContent;
		document.querySelector('button')!.click();
		await tick();
		expect(span.textContent).toBe(initial);
	});
});

describe('state > primitive > string', () => {
	it('updates string state', async () => {
		component App() {
			state msg = 'hello';
			render (
				<button onclick={() => msg = 'world'}>change</button>
				<span>{msg}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('hello');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('world');
	});

	it('updates with string concatenation (+=)', async () => {
		component App() {
			state msg = 'a';
			render (
				<button onclick={() => msg += 'b'}>append</button>
				<span>{msg}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('ab');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('abb');
	});
});

describe('state > primitive > boolean', () => {
	it('toggles boolean state', async () => {
		component App() {
			state flag = false;
			render (
				<button onclick={() => flag = !flag}>toggle</button>
				<span>{flag ? 'on' : 'off'}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('off');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('on');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('off');
	});
});

// ─── Object state (proxy) ──────────────────────────────────────────

describe('state > object > shallow property', () => {
	it('reacts to property mutation', async () => {
		component App() {
			state user = { name: 'Alice', age: 25 };
			render (
				<button onclick={() => user.name = 'Bob'}>rename</button>
				<span class="name">{user.name}</span>
				<span class="age">{user.age}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('.name')!.textContent).toBe('Alice');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.name')!.textContent).toBe('Bob');
		// age unchanged
		expect(document.querySelector('.age')!.textContent).toBe('25');
	});

	it('reacts to multiple property mutations in one handler', async () => {
		component App() {
			state user = { name: 'A', age: 1 };

			function changeBoth() {
				user.name = 'B';
				user.age = 2;
			}

			render (
				<button onclick={changeBoth}>change</button>
				<span class="name">{user.name}</span>
				<span class="age">{user.age}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.name')!.textContent).toBe('B');
		expect(document.querySelector('.age')!.textContent).toBe('2');
	});

	it('reacts to adding new property', async () => {
		component App() {
			state obj = { a: 1 };
			render (
				<button onclick={() => obj.b = 2}>add</button>
				<span>{obj.b ?? 'none'}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('none');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
	});
});

describe('state > object > deep nesting', () => {
	it('reacts to deeply nested mutation', async () => {
		component App() {
			state data = { a: { b: { c: 'deep' } } };
			render (
				<button onclick={() => data.a.b.c = 'changed'}>change</button>
				<span>{data.a.b.c}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('deep');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('changed');
	});

	it('reacts to replacing nested object', async () => {
		component App() {
			state data = { child: { val: 1 } };
			render (
				<button onclick={() => data.child = { val: 99 }}>replace</button>
				<span>{data.child.val}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('99');
	});
});

describe('state > object > root reassignment', () => {
	it('reacts to whole-object reassignment via $.set()', async () => {
		component App() {
			state user = { name: 'Alice' };
			render (
				<button onclick={() => user = { name: 'Bob' }}>replace</button>
				<span>{user.name}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('Alice');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('Bob');
	});

	it('reacts to root reassignment from object to different object', async () => {
		component App() {
			state data = { x: 1, y: 2 };
			render (
				<button onclick={() => data = { x: 10, y: 20 }}>swap</button>
				<span class="x">{data.x}</span>
				<span class="y">{data.y}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('.x')!.textContent).toBe('1');
		expect(document.querySelector('.y')!.textContent).toBe('2');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.x')!.textContent).toBe('10');
		expect(document.querySelector('.y')!.textContent).toBe('20');
	});
});

// ─── Array state (proxy) ───────────────────────────────────────────

describe('state > array > mutations', () => {
	it('reacts to push', async () => {
		component App() {
			state items = ['a'];
			render (
				<button onclick={() => items.push('b')}>push</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('a');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a,b');
	});

	it('reacts to pop', async () => {
		component App() {
			state items = ['a', 'b', 'c'];
			render (
				<button onclick={() => items.pop()}>pop</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a,b');
	});

	it('reacts to splice', async () => {
		component App() {
			state items = ['a', 'b', 'c'];
			render (
				<button onclick={() => items.splice(1, 1, 'x')}>splice</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a,x,c');
	});

	it('reacts to unshift', async () => {
		component App() {
			state items = ['b', 'c'];
			render (
				<button onclick={() => items.unshift('a')}>unshift</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a,b,c');
	});

	it('reacts to shift', async () => {
		component App() {
			state items = ['a', 'b', 'c'];
			render (
				<button onclick={() => items.shift()}>shift</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('b,c');
	});

	it('reacts to sort', async () => {
		component App() {
			state items = [3, 1, 2];
			render (
				<button onclick={() => items.sort()}>sort</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1,2,3');
	});

	it('reacts to reverse', async () => {
		component App() {
			state items = [1, 2, 3];
			render (
				<button onclick={() => items.reverse()}>reverse</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3,2,1');
	});

	it('reacts to index assignment', async () => {
		component App() {
			state items = ['a', 'b', 'c'];
			render (
				<button onclick={() => items[1] = 'z'}>change</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a,z,c');
	});

	it('reacts to length assignment', async () => {
		component App() {
			state items = ['a', 'b', 'c', 'd'];
			render (
				<button onclick={() => items.length = 2}>truncate</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a,b');
	});

	it('reacts to root array reassignment', async () => {
		component App() {
			state items = [1, 2];
			render (
				<button onclick={() => items = [10, 20, 30]}>replace</button>
				<span>{items.join(',')}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1,2');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('10,20,30');
	});

	it('reacts to array of objects mutation', async () => {
		component App() {
			state items = [{ name: 'a' }, { name: 'b' }];
			render (
				<button onclick={() => items[0].name = 'z'}>change</button>
				<span>{items.map(i => i.name).join(',')}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('a,b');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('z,b');
	});
});

// ─── Derived state ─────────────────────────────────────────────────

describe('derived > from primitives', () => {
	it('computes from a single state', async () => {
		component App() {
			state n = 3;
			derived sq = n * n;
			render (
				<button onclick={() => n = 5}>set</button>
				<span>{sq}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('9');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('25');
	});

	it('computes from multiple states', async () => {
		component App() {
			state a = 2;
			state b = 3;
			derived sum = a + b;
			render (
				<button class="a" onclick={() => a = 10}>a</button>
				<button class="b" onclick={() => b = 20}>b</button>
				<span>{sum}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('5');
		document.querySelector<HTMLElement>('.a')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('13');
		document.querySelector<HTMLElement>('.b')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('30');
	});

	it('chains derived → derived', async () => {
		component App() {
			state x = 2;
			derived doubled = x * 2;
			derived quadrupled = doubled * 2;
			render (
				<button onclick={() => x = 5}>set</button>
				<span class="d">{doubled}</span>
				<span class="q">{quadrupled}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('.d')!.textContent).toBe('4');
		expect(document.querySelector('.q')!.textContent).toBe('8');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.d')!.textContent).toBe('10');
		expect(document.querySelector('.q')!.textContent).toBe('20');
	});

	it('three-level derived chain', async () => {
		component App() {
			state n = 1;
			derived a = n + 1;
			derived b = a + 1;
			derived c = b + 1;
			render (
				<button onclick={() => n = 10}>set</button>
				<span>{c}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('4');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('13');
	});
});

describe('derived > from proxy state', () => {
	it('derives from object property', async () => {
		component App() {
			state user = { first: 'A', last: 'B' };
			derived full = user.first + ' ' + user.last;
			render (
				<button onclick={() => user.first = 'X'}>change</button>
				<span>{full}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('A B');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('X B');
	});

	it('derives from array method', async () => {
		component App() {
			state nums = [1, 2, 3];
			derived sum = nums.reduce((a, b) => a + b, 0);
			render (
				<button onclick={() => nums.push(4)}>add</button>
				<span>{sum}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('6');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('10');
	});

	it('derives filtered list from array state', async () => {
		component App() {
			state items = [1, 2, 3, 4, 5];
			derived evens = items.filter(x => x % 2 === 0);
			render (
				<button onclick={() => items.push(6)}>add</button>
				<span>{evens.join(',')}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2,4');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2,4,6');
	});

	it('derives count from array length', async () => {
		component App() {
			state items = ['a'];
			derived count = items.length;
			render (
				<button onclick={() => items.push('x')}>add</button>
				<span>{count}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3');
	});
});

describe('derived > object-valued', () => {
	it('accesses properties on derived object directly', async () => {
		component App() {
			state first = 'A';
			state last = 'B';
			derived full = first + ' ' + last;
			render (
				<button onclick={() => first = 'X'}>change</button>
				<span class="full">{full}</span>
				<span class="first">{first}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('.full')!.textContent).toBe('A B');
		expect(document.querySelector('.first')!.textContent).toBe('A');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('.full')!.textContent).toBe('X B');
		expect(document.querySelector('.first')!.textContent).toBe('X');
	});
});

describe('derived > skip propagation', () => {
	it('does not re-render when derived output unchanged', async () => {
		component App() {
			state n = 1;
			derived clamped = Math.min(n, 10);
			state renderCount = 0;
			render (
				<button onclick={() => n++}>inc</button>
				<span>{clamped}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1');
		// Set n from 1 → 2, clamped changes to 2
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
	});

	it('boolean derived does not fire when staying same', async () => {
		component App() {
			state count = 0;
			derived positive = count > 0;
			state log = '';

			effect(positive, (val, prev) => {
				log = prev + '->' + val;
			});

			render (
				<button onclick={() => count++}>inc</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		// Initial: false->false
		expect(document.querySelector('span')!.textContent).toBe('false->false');

		// 0 → 1: positive changes false → true
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('false->true');

		// 1 → 2: positive stays true — effect should NOT fire
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('false->true');
	});
});

// ─── Effect: primitives ────────────────────────────────────────────

describe('effect > primitive state', () => {
	it('fires on number increment', async () => {
		component App() {
			state count = 0;
			state log = '';
			effect(count, (v, prev) => { log = prev + ':' + v; });
			render (
				<button onclick={() => count++}>inc</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0:0');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('0:1');
	});

	it('fires on string reassignment', async () => {
		component App() {
			state msg = 'a';
			state log = '';
			effect(msg, (v, prev) => { log = prev + ':' + v; });
			render (
				<button onclick={() => msg = 'b'}>set</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('a:a');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a:b');
	});

	it('fires on boolean toggle', async () => {
		component App() {
			state flag = false;
			state log = '';
			effect(flag, (v, prev) => { log = prev + ':' + v; });
			render (
				<button onclick={() => flag = !flag}>toggle</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('false:true');
	});

	it('does NOT fire when value unchanged', async () => {
		component App() {
			state n = 5;
			state count = 0;
			effect(n, () => { count++; });
			render (
				<button onclick={() => n = 5}>same</button>
				<span>{count}</span>
			);
		}
		mount(App, document.body);
		// Initial run fires once
		expect(document.querySelector('span')!.textContent).toBe('1');
		document.querySelector('button')!.click();
		await tick();
		// Should still be 1 — no change
		expect(document.querySelector('span')!.textContent).toBe('1');
	});
});

// ─── Effect: proxy root (whole object) ─────────────────────────────

describe('effect > proxy root (whole object)', () => {
	it('fires when shallow property mutated', async () => {
		component App() {
			state obj = { a: 1, b: 2 };
			state log = '';
			effect(obj, (cur, prev) => { log = prev.a + ':' + cur.a; });
			render (
				<button onclick={() => obj.a = 99}>change</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1:1');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1:99');
	});

	it('fires when deeply nested property mutated', async () => {
		component App() {
			state data = { nested: { deep: 'old' } };
			state log = '';
			effect(data, (cur, prev) => { log = prev.nested.deep + ':' + cur.nested.deep; });
			render (
				<button onclick={() => data.nested.deep = 'new'}>change</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('old:old');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('old:new');
	});

	it('fires when array element pushed', async () => {
		component App() {
			state arr = [1, 2];
			state log = '';
			effect(arr, (cur, prev) => { log = prev.length + ':' + cur.length; });
			render (
				<button onclick={() => arr.push(3)}>push</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2:2');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2:3');
	});

	it('fires when array element changed by index', async () => {
		component App() {
			state arr = ['a', 'b'];
			state log = '';
			effect(arr, (cur, prev) => { log = prev[0] + ':' + cur[0]; });
			render (
				<button onclick={() => arr[0] = 'z'}>change</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a:z');
	});
});

// ─── Effect: specific property (granular tracking) ─────────────────

describe('effect > specific property', () => {
	it('fires only when watched property changes', async () => {
		component App() {
			state obj = { x: 1, y: 2 };
			state log = '';
			effect(obj.x, (v, prev) => { log = prev + ':' + v; });
			render (
				<button class="x" onclick={() => obj.x = 10}>x</button>
				<button class="y" onclick={() => obj.y = 20}>y</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1:1');

		// Change y — should NOT fire
		document.querySelector<HTMLElement>('.y')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1:1');

		// Change x — should fire
		document.querySelector<HTMLElement>('.x')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1:10');
	});

	it('fires only when watched nested property changes', async () => {
		component App() {
			state data = { a: { val: 1 }, b: { val: 2 } };
			state log = '';
			effect(data.a.val, (v, prev) => { log = prev + ':' + v; });
			render (
				<button class="a" onclick={() => data.a.val = 100}>a</button>
				<button class="b" onclick={() => data.b.val = 200}>b</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1:1');

		document.querySelector<HTMLElement>('.b')!.click();
		await tick();
		// b changed, but we watch a.val — no fire
		expect(document.querySelector('span')!.textContent).toBe('1:1');

		document.querySelector<HTMLElement>('.a')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1:100');
	});

	it('fires for array length property', async () => {
		component App() {
			state items = [1, 2];
			state log = '';
			effect(items.length, (v, prev) => { log = prev + ':' + v; });
			render (
				<button onclick={() => items.push(3)}>push</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('2:2');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2:3');
	});
});

// ─── Effect: derived values ────────────────────────────────────────

describe('effect > watching derived', () => {
	it('fires when derived changes due to state change', async () => {
		component App() {
			state n = 2;
			derived doubled = n * 2;
			state log = '';
			effect(doubled, (v, prev) => { log = prev + ':' + v; });
			render (
				<button onclick={() => n = 5}>set</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('4:4');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('4:10');
	});

	it('does not fire when derived stays same', async () => {
		component App() {
			state n = 3;
			derived clamped = Math.min(n, 5);
			state fireCount = 0;
			effect(clamped, () => { fireCount++; });
			render (
				<button onclick={() => n = 100}>big</button>
				<button class="small" onclick={() => n = 4}>small</button>
				<span>{fireCount}</span>
			);
		}
		mount(App, document.body);
		// Initial fire
		expect(document.querySelector('span')!.textContent).toBe('1');

		// n=3 → 100, clamped 3 → 5 — fires
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');

		// n=100 → 4, clamped 5 → 4 — fires
		document.querySelector<HTMLElement>('.small')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3');
	});

	it('fires when derived chain updates', async () => {
		component App() {
			state n = 1;
			derived a = n * 2;
			derived b = a + 10;
			state log = '';
			effect(b, (v, prev) => { log = prev + ':' + v; });
			render (
				<button onclick={() => n = 5}>set</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('12:12');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('12:20');
	});
});

// ─── Effect: multiple dependencies ─────────────────────────────────

describe('effect > multiple deps', () => {
	it('fires when any dep changes', async () => {
		component App() {
			state a = 1;
			state b = 2;
			state log = '';
			effect([a, b], ([na, pa], [nb, pb]) => { log = `${pa},${pb}->${na},${nb}`; });
			render (
				<button class="a" onclick={() => a = 10}>a</button>
				<button class="b" onclick={() => b = 20}>b</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('1,2->1,2');

		document.querySelector<HTMLElement>('.a')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1,2->10,2');

		document.querySelector<HTMLElement>('.b')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('10,2->10,20');
	});

	it('mixed primitive + proxy deps', async () => {
		component App() {
			state count = 0;
			state obj = { val: 'x' };
			state log = '';
			effect([count, obj], ([nc, pc], [no, po]) => {
				log = `${pc},${po.val}->${nc},${no.val}`;
			});
			render (
				<button class="c" onclick={() => count++}>c</button>
				<button class="o" onclick={() => obj.val = 'y'}>o</button>
				<span>{log}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0,x->0,x');

		document.querySelector<HTMLElement>('.c')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('0,x->1,x');

		document.querySelector<HTMLElement>('.o')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1,x->1,y');
	});
});

// ─── Effect: cleanup ───────────────────────────────────────────────

describe('effect > cleanup', () => {
	it('runs cleanup before every re-run', async () => {
		component App() {
			state n = 0;
			state cleanups = '';
			effect(n, (v) => {
				onCleanup(() => { cleanups += v + ','; });
			});
			render (
				<button onclick={() => n++}>inc</button>
				<span>{cleanups}</span>
			);
		}
		mount(App, document.body);
		// No cleanup yet (first run)
		expect(document.querySelector('span')!.textContent).toBe('');

		document.querySelector('button')!.click();
		await tick();
		// Cleanup from v=0 run
		expect(document.querySelector('span')!.textContent).toBe('0,');

		document.querySelector('button')!.click();
		await tick();
		// Cleanup from v=0 and v=1
		expect(document.querySelector('span')!.textContent).toBe('0,1,');
	});
});

// ─── DOM reactivity: multiple reads in one expression ──────────────

describe('reactivity > expression combinations', () => {
	it('ternary with two states', async () => {
		component App() {
			state a = 1;
			state b = 2;
			render (
				<button class="a" onclick={() => a = 10}>a</button>
				<button class="b" onclick={() => b = 20}>b</button>
				<span>{a > b ? 'a wins' : 'b wins'}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('b wins');
		document.querySelector<HTMLElement>('.a')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('a wins');
	});

	it('template string with multiple states', async () => {
		component App() {
			state first = 'John';
			state last = 'Doe';

			function changeBoth() {
				first = 'Jane';
				last = 'Smith';
			}

			render (
				<button onclick={changeBoth}>change</button>
				<span>{first + ' ' + last}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('John Doe');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('Jane Smith');
	});
});

// ─── Batching: multiple changes in one handler ─────────────────────

describe('reactivity > batching', () => {
	it('batches multiple state changes into one flush', async () => {
		component App() {
			state a = 0;
			state b = 0;
			derived sum = a + b;

			function setBoth() {
				a = 1;
				b = 2;
			}

			render (
				<button onclick={setBoth}>both</button>
				<span>{sum}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3');
	});

	it('multiple proxy mutations in one handler batch correctly', async () => {
		component App() {
			state user = { name: 'A', age: 1 };
			derived info = user.name + ':' + user.age;

			function changeBoth() {
				user.name = 'B';
				user.age = 2;
			}

			render (
				<button onclick={changeBoth}>change</button>
				<span>{info}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('A:1');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('B:2');
	});
});

// ─── Edge cases ────────────────────────────────────────────────────

describe('reactivity > edge cases', () => {
	it('state initialized to null then set to object', async () => {
		component App() {
			state data = null;
			render (
				<button onclick={() => data = { x: 1 }}>set</button>
				<span>{data ? data.x : 'null'}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('null');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');
	});

	it('state initialized to undefined', async () => {
		component App() {
			state val = undefined;
			render (
				<button onclick={() => val = 42}>set</button>
				<span>{val ?? 'empty'}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('empty');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('42');
	});

	it('state holding 0 (falsy but valid)', async () => {
		component App() {
			state n = 0;
			render <span>{n}</span>;
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0');
	});

	it('state holding empty string (falsy but valid)', async () => {
		component App() {
			state s = '';
			render (
				<button onclick={() => s = 'hello'}>set</button>
				<span>{s || 'empty'}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('empty');
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('hello');
	});

	it('rapid successive updates converge to final value', async () => {
		component App() {
			state n = 0;

			function setRapid() {
				n = 1;
				n = 2;
				n = 3;
			}

			render (
				<button onclick={setRapid}>rapid</button>
				<span>{n}</span>
			);
		}
		mount(App, document.body);
		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('3');
	});

	it('derived from another derived and a state', async () => {
		component App() {
			state a = 1;
			state b = 10;
			derived c = a + 1;
			derived d = c + b;
			render (
				<button class="a" onclick={() => a = 5}>a</button>
				<button class="b" onclick={() => b = 100}>b</button>
				<span>{d}</span>
			);
		}
		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('12');
		document.querySelector<HTMLElement>('.a')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('16');
		document.querySelector<HTMLElement>('.b')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('106');
	});
});
