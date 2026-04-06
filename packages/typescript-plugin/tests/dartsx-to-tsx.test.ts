import { describe, it, expect } from 'vitest';
import { dartsxToTsx, isDarTsxFile } from '../src/dartsx-to-tsx';

describe('isDarTsxFile', () => {
	it('detects DarTsx files with component keyword', () => {
		expect(isDarTsxFile('export default component App() {}')).toBe(true);
		expect(isDarTsxFile('component Counter() {}')).toBe(true);
		expect(isDarTsxFile('export component Foo() {}')).toBe(true);
		expect(isDarTsxFile('async component Bar() {}')).toBe(true);
	});

	it('detects DarTsx-only syntax inside regular function components', () => {
		expect(isDarTsxFile('export default function App() { return <input bind:value={name} /> }')).toBe(true);
		expect(isDarTsxFile('function App() { return <Badge bind:display-name={name} /> }')).toBe(true);
		expect(isDarTsxFile('function App() { render (<div />) }')).toBe(true);
		expect(isDarTsxFile('function App() { derived { user: { name } } = loadUser() }')).toBe(true);
	});

	it('rejects regular TSX files', () => {
		expect(isDarTsxFile('function App() { return <div/> }')).toBe(false);
		expect(isDarTsxFile('const x = 1;')).toBe(false);
		expect(isDarTsxFile('export default function Counter() {}')).toBe(false);
	});
});

describe('dartsxToTsx', () => {
	it('transforms component → function', () => {
		const { code } = dartsxToTsx('component Counter() {}');
		expect(code).toContain('function Counter(props: {}): Node;');
		expect(code).toContain('function Counter() {}');
	});

	it('transforms export default component → export default function', () => {
		const { code } = dartsxToTsx('export default component Counter() {}');
		expect(code).toBe('export default function Counter() {}');
	});

	it('transforms async component', () => {
		const { code } = dartsxToTsx('async component Loader() {}');
		expect(code).toContain('function Loader(props: {}): Promise<Node>;');
		expect(code).toContain('async function Loader() {}');
	});

	it('adds a JSX props overload for exported components', () => {
		const source = 'export component UserCard(bind name: string, age: number, active: boolean = true) {}';
		const { code } = dartsxToTsx(source);
		expect(code).toContain('export function UserCard(props: { name?: string; "bind:name"?: any; age: number; active?: boolean; }): Node;');
		expect(code).toContain('export function UserCard(name: string, age: number, active: boolean = true) {}');
	});

	it('adds renamed prop keys to the JSX props overload', () => {
		const source = "export component UserBadge(bind 'display-name' as displayName: string, status: string = 'offline') {}";
		const { code } = dartsxToTsx(source);
		expect(code).toContain('export function UserBadge(props: { "display-name"?: string; "bind:display-name"?: any; status?: string; }): Node;');
		expect(code).toContain("export function UserBadge(displayName: string, status: string = 'offline') {}");
	});

	it('transforms state → let', () => {
		const { code } = dartsxToTsx('state count = 0');
		expect(code).toBe('let count = 0');
	});

	it('transforms export state → export let', () => {
		const { code } = dartsxToTsx('export state count = 0');
		expect(code).toBe('export let count = 0');
	});

	it('transforms derived → const', () => {
		const { code } = dartsxToTsx('derived doubled = count * 2');
		expect(code).toContain('const doubled = count * 2');
	});

	it('transforms derived destructuring → const destructuring', () => {
		const { code } = dartsxToTsx('derived { count, increment } = CounterCtx()');
		expect(code).toContain('const { count, increment } = CounterCtx()');
	});

	it('transforms deep derived destructuring → const destructuring', () => {
		const { code } = dartsxToTsx('derived { user: { name }, items: [first, { label: itemLabel }] } = CounterCtx()');
		expect(code).toContain('const { user: { name }, items: [first, { label: itemLabel }] } = CounterCtx()');
	});

	it('preserves defaults and object rest in derived destructuring', () => {
		const { code } = dartsxToTsx("derived { user: { name = 'anon' }, ...rest } = CounterCtx()");
		expect(code).toContain("const { user: { name = 'anon' }, ...rest } = CounterCtx()");
	});

	it('preserves defaults and array rest in derived destructuring', () => {
		const { code } = dartsxToTsx('derived [first = 1, ...rest] = CounterCtx()');
		expect(code).toContain('const [first = 1, ...rest] = CounterCtx()');
	});

	it('transforms render block to return with fragment', () => {
		const { code } = dartsxToTsx('render (\n  <div>hello</div>\n)');
		expect(code).toContain('return');
		expect(code).toContain('<>');
		expect(code).toContain('</>');
		expect(code).toContain('<div>hello</div>');
	});

	it('transforms bind:value to __bind_value', () => {
		const { code } = dartsxToTsx('<input bind:value={name} />');
		expect(code).toContain('__bind_value={name}');
		expect(code).not.toContain('bind:');
	});

	it('transforms bind:checked to __bind_checked', () => {
		const { code } = dartsxToTsx('<input bind:checked={active} />');
		expect(code).toContain('__bind_checked={active}');
	});

	it('transforms hyphenated bind attributes', () => {
		const { code } = dartsxToTsx('<Badge bind:display-name={profile.displayName} />');
		expect(code).toContain('__bind_display-name={profile.displayName}');
		expect(code).not.toContain('bind:display-name');
	});

	it('transforms bind:{x} shorthand', () => {
		const { code } = dartsxToTsx('<input bind:{value} />');
		expect(code).toContain('__bind_value={value}');
	});

	it('transforms bind in params to just the param name', () => {
		const { code } = dartsxToTsx('function Foo(bind name: string) {}');
		expect(code).toContain('function Foo(name: string)');
		expect(code).not.toContain('bind');
	});

	it('transforms renamed props to local parameter names', () => {
		const { code } = dartsxToTsx("component UserBadge('display-name' as displayName: string) {}");
		expect(code).toContain('function UserBadge(displayName: string)');
		expect(code).not.toContain("'display-name' as");
	});

	it('transforms multiple renamed props with defaults', () => {
		const source = "component UserBadge('display-name' as displayName: string, 'status-text' as statusText: string = 'offline') {}";
		const { code } = dartsxToTsx(source);
		expect(code).toContain("function UserBadge(displayName: string, statusText: string = 'offline')");
	});

	it('transforms bind used with renamed props to the local parameter name', () => {
		const source = "component UserBadge(bind 'display-name' as displayName: string) {}";
		const { code } = dartsxToTsx(source);
		expect(code).toContain('function UserBadge(props: { "display-name"?: string; "bind:display-name"?: any; }): Node;');
		expect(code).toContain('function UserBadge(displayName: string)');
		expect(code).not.toContain("'display-name' as");
	});

	it('handles a complete Counter component', () => {
		const source = [
			'export default component Counter() {',
			'  state name = "world"',
			'  state count = 0',
			'  derived doubled = count * 2',
			'',
			'  render (',
			'    <h1>Hello {name}!</h1>',
			'    <input bind:value={name} />',
			'    <button onclick={count++}>',
			'      clicks: {count}',
			'    </button>',
			'    <p>doubled: {doubled}</p>',
			'  )',
			'}',
		].join('\n');

		const { code } = dartsxToTsx(source);

		expect(code).toContain('export default function');
		expect(code).toContain('let name = "world"');
		expect(code).toContain('let count = 0');
		expect(code).toContain('const doubled = count * 2');
		expect(code).toContain('return');
		expect(code).toContain('<>');
		expect(code).toContain('<h1>Hello {name}!</h1>');
		expect(code).toContain('__bind_value={name}');
		expect(code).not.toContain('component');
		expect(code).not.toContain('state ');
		expect(code).not.toContain('derived ');
		expect(code).not.toContain('render (');
		expect(code).not.toContain('bind:');
	});

	it('does not transform non-DarTsx code', () => {
		const source = 'function App() { return <div>hello</div> }';
		const { code } = dartsxToTsx(source);
		expect(code).toBe(source);
	});

	it('preserves regular state property access', () => {
		const source = 'obj.state = 5';
		const { code } = dartsxToTsx(source);
		expect(code).toBe(source);
	});
});
