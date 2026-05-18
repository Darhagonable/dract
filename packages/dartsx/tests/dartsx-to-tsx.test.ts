import { describe, it, expect } from 'vitest';
import { dartsxToTsx, isDarTsxFile } from '../src/dartsx-to-tsx';
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

/** Parse transformed code through TypeScript and return syntax errors */
function getTsSyntaxErrors(code: string, fileName = 'test.tsx'): string[] {
	const kind = fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
		? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind);
	return (sf as any).parseDiagnostics?.map((d: ts.DiagnosticWithLocation) => {
		const pos = ts.getLineAndCharacterOfPosition(sf, d.start);
		return `L${pos.line + 1}:${pos.character} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
	}) ?? [];
}

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
		expect(code).toBe('function Counter() {}');
	});

	it('transforms export default component → export default function', () => {
		const { code } = dartsxToTsx('export default component Counter() {}');
		expect(code).toBe('export default function Counter() {}');
	});

	it('transforms async component', () => {
		const { code } = dartsxToTsx('async component Loader() {}');
		expect(code).toBe('async function Loader() {}');
	});

	it('transforms exported component with params', () => {
		const source = 'export component UserCard(bind name: string, age: number, active: boolean = true) {}';
		const { code } = dartsxToTsx(source);
		expect(code).toBe('export function UserCard({name, age, active = true}: {name: string, age: number, active?: boolean}) {}');
	});

	it('transforms renamed props', () => {
		const source = "export component UserBadge(bind 'display-name' as displayName: string, status: string = 'offline') {}";
		const { code } = dartsxToTsx(source);
		expect(code).toContain("export function UserBadge({'display-name': displayName, status = 'offline'}: {'display-name': string, status?: string})");
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

	it('transforms renamed props to local parameter names', () => {
		const { code } = dartsxToTsx("component UserBadge('display-name' as displayName: string) {}");
		expect(code).toContain("function UserBadge({'display-name': displayName}: {'display-name': string})");
		expect(code).not.toContain(" as ");
	});

	it('transforms multiple renamed props with defaults', () => {
		const source = "component UserBadge('display-name' as displayName: string, 'status-text' as statusText: string = 'offline') {}";
		const { code } = dartsxToTsx(source);
		expect(code).toContain("function UserBadge({'display-name': displayName, 'status-text': statusText = 'offline'}: {'display-name': string, 'status-text'?: string})");
	});

	it('transforms bind used with renamed props to the local parameter name', () => {
		const source = "component UserBadge(bind 'display-name' as displayName: string) {}";
		const { code } = dartsxToTsx(source);
		expect(code).toContain("function UserBadge({'display-name': displayName}: {'display-name': string})");
		expect(code).not.toContain(" as ");
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

	it('wraps {if} in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  state show = true;
  render (
    <div>{if (show) { render <p>Hi</p> }}</div>
  )
}`);
		expect(code).toContain('{(() => { if (show)');
		expect(code).toContain('})()}');
		expect(code).toContain('return <p>Hi</p>');
	});

	it('wraps {if/else if/else} in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  state x = 1;
  render (
    <div>{if (x === 1) {
      render <p>One</p>
    } else if (x === 2) {
      render <p>Two</p>
    } else {
      render <p>Other</p>
    }}</div>
  )
}`);
		expect(code).toContain('{(() => { if (x === 1)');
		expect(code).toContain('else if (x === 2)');
		expect(code).toContain('else {');
		expect(code).toContain('})()}');
	});

	it('wraps {for} in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  render (
    <ul>{for (const [item, index] of items) {
      render <li key={index}>{item}</li>
    }}</ul>
  )
}`);
		expect(code).toContain('{(() => { for (const [item, index] of items)');
		expect(code).toContain('})()}');
	});

	it('wraps {switch} in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  state mode = "dark";
  render (
    <div>{switch (mode) {
      case "dark": render <p>Dark</p>
      case "light": render <p>Light</p>
    }}</div>
  )
}`);
		expect(code).toContain('{(() => { switch (mode)');
		expect(code).toContain('})()}');
	});

	it('wraps {try/catch} in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  render (
    <div>{try {
      render <Data />
    } catch (e) {
      render <p>Error</p>
    }}</div>
  )
}`);
		expect(code).toContain('{(() => { try {');
		expect(code).toContain('} catch (e) {');
		expect(code).toContain('})()}');
	});

	it('wraps {try/pending/catch} in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  render (
    <div>{try {
      render <Data />
    } pending {
      render <p>Loading</p>
    } catch (e) {
      render <p>Error</p>
    }}</div>
  )
}`);
		expect(code).toContain('{(() => { try {');
		expect(code).toContain('} pending {');
		expect(code).toContain('} catch (e) {');
		expect(code).toContain('})()}');
	});

	it('wraps {try} paren body in JSX with IIFE', () => {
		const { code } = dartsxToTsx(`component App() {
  render (
    <div>{try (<Data />) catch (e) (<p>Error</p>)}</div>
  )
}`);
		expect(code).toContain('{(() => { try { return (<Data />) }');
		expect(code).toContain('catch (e) { return (<p>Error</p>) } })()');
	});
});

describe('event handler wrapping', () => {
	it('wraps bare assignment in attribute', () => {
		const { code } = dartsxToTsx('<div onclick={x = 5} />');
		expect(code).toContain('onclick={() => x = 5}');
	});

	it('wraps bare update expression in attribute', () => {
		const { code } = dartsxToTsx('<input oninput={count++} />');
		expect(code).toContain('oninput={() => count++}');
	});

	it('does not wrap arrow function with assignment in body', () => {
		const { code } = dartsxToTsx('<input oninput={(e) => username = e.target?.value} />');
		expect(code).toContain('oninput={(e) => username = e.target?.value}');
	});

	it('does not wrap arrow function with no parens', () => {
		const { code } = dartsxToTsx('<input oninput={e => username = e.target?.value} />');
		expect(code).toContain('oninput={e => username = e.target?.value}');
	});

	it('does not wrap function expression', () => {
		const { code } = dartsxToTsx('<div onclick={function() { x = 5 }} />');
		expect(code).toContain('onclick={function() { x = 5 }}');
	});
});

describe('dartsxToTsx produces valid TypeScript', () => {
	// Inline snippets — every DarTsx pattern must produce parseable TSX
	const snippets: [string, string][] = [
		['render (expr)', 'component A() { render (<div>hi</div>) }'],
		['render <JSX>', 'component A() { render <div>hi</div> }'],
		['render expression', 'component A() { render getNode(); }'],
		['render optional chain', 'component A() { render match?.handler(params) ?? null; }'],
		['{@html expr}', 'component A() { render (<div>{@html markup}</div>) }'],
		['bind:value', '<input bind:value={x} />'],
		['bind shorthand', '<input bind:{value} />'],
		['state + derived', 'component A() { state x = 0\n  derived y = x * 2 }'],
		['component with props', 'component A(name: string, age?: number) {}'],
		['if control flow (paren)', 'component A() { render (<div>{if (x) (<p>yes</p>)}</div>) }'],
		['if control flow (block)', 'component A() { render (<div>{if (x) { render <p>yes</p> }}</div>) }'],
		['for control flow (paren)', 'component A() { render (<div>{for (const item of items) (<p>{item}</p>)}</div>) }'],
		['for control flow (block)', 'component A() { render (<div>{for (const item of items) { render <p>{item}</p> }}</div>) }'],
		['switch control flow', 'component A() { render (<div>{switch (x) { case 1: render <p>one</p> }}</div>) }'],
		['try control flow (paren)', 'component A() { render (<div>{try (<Data />) catch (e) (<p>Error</p>)}</div>) }'],
		['try control flow (block)', 'component A() { render (<div>{try { render <Data /> } catch (e) { render <p>Error</p> }}</div>) }'],
	];

	for (const [name, source] of snippets) {
		it(`snippet: ${name}`, () => {
			const { code } = dartsxToTsx(source);
			const errors = getTsSyntaxErrors(code);
			expect(errors, `Transform produced invalid TSX:\n${code}\n\nErrors:\n${errors.join('\n')}`).toEqual([]);
		});
	}

	// Scan all project .tsx/.ts source files
	const rootDir = path.resolve(__dirname, '../../..');
	const scanDirs = ['playground/src', 'toolkit'];

	function collectDarTsxFiles(dir: string): string[] {
		const files: string[] = [];
		if (!fs.existsSync(dir)) return files;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules') continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...collectDarTsxFiles(full));
				continue;
			}
			if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
			if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) continue;
			try {
				const src = fs.readFileSync(full, 'utf-8');
				if (isDarTsxFile(src)) files.push(full);
			} catch { /* skip unreadable */ }
		}
		return files;
	}

	const dartsxFiles = scanDirs.flatMap(d => collectDarTsxFiles(path.join(rootDir, d)));

	for (const file of dartsxFiles) {
		const rel = path.relative(rootDir, file);
		it(`file: ${rel}`, () => {
			const src = fs.readFileSync(file, 'utf-8');
			const { code } = dartsxToTsx(src);
			const errors = getTsSyntaxErrors(code, file);
			expect(errors, `dartsxToTsx produced invalid TypeScript for ${rel}:\n\nTransformed:\n${code.slice(0, 500)}...\n\nErrors:\n${errors.join('\n')}`).toEqual([]);
		});
	}
});
