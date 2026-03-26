import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler/index.js';

function normalizeWhitespace(code: string): string {
  return code
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');
}

describe('compiler', () => {
  it('compiles a basic component with state, derived, events, and binding', () => {
    const source = `component HelloWorld() {
  state name = "world"
  state count = 0
  derived doubled = count * 2

  render (
    <h1>Hello {name}</h1>
    <input bind:value={name} />
    <button onclick={count += 1}>
      clicks: {count}
    </button>
    <p>doubled: {doubled}</p>
  )
}`;

    const result = compile(source);
    const code = normalizeWhitespace(result.code);

    // Should have runtime import
    expect(code).toContain("import $ from 'dartsx/internal/client';");

    // Should have hoisted template declarations — one per element
    expect(code).toContain('const _h1 = $.template(`<h1> </h1>`)');
    expect(code).toContain('const _input = $.template(`<input/>`)');
    expect(code).toContain('const _button = $.template(`<button> </button>`)');
    expect(code).toContain('const _p = $.template(`<p> </p>`)');
    // Should have function declaration
    expect(code).toContain('function HelloWorld($$anchor)');

    // Should have state declarations
    expect(code).toContain('let name = $.state("world");');
    expect(code).toContain('let count = $.state(0);');

    // Should have derived declaration with $.get() wrapping
    expect(code).toContain('let doubled = $.derived(() => $.get(count) * 2);');

    // Should have per-element $.node() calls
    expect(code).toContain('const h1 = $.node(_h1, (el) => {');
    expect(code).toContain('const input = $.node(_input, (el) => {');
    expect(code).toContain('const button = $.node(_button, (el) => {');
    expect(code).toContain('const p = $.node(_p, (el) => {');

    // Should have granular effects with text.data updates
    expect(code).toContain('$.effect(() => {');
    expect(code).toContain('text.data = `Hello ${$.get(name)');
    expect(code).toContain('text.data = `clicks: ${$.get(count)');
    expect(code).toContain('text.data = `doubled: ${$.get(doubled)');

    // Should have bind:value
    expect(code).toContain('$.bindValue(el, name)');

    // Should have delegated click event with transformed assignment
    expect(code).toContain("$.delegated('click', el, () => $.set(count, $.get(count) + 1))");

    // Should append all elements
    expect(code).toContain('$.append($$anchor, h1, input, button, p)');
  });

  it('compiles export default component', () => {
    const source = `export default component Greeting(name: string = "World") {
  render (
    <h1>Hello, {name}</h1>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('export default function Greeting($$anchor, $$props)');
    expect(result.code).toContain('$.prop($$props.name, "World")');
  });

  it('compiles export component', () => {
    const source = `export component Counter() {
  state count = 0
  render (
    <button onclick={count++}>{count}</button>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('export function Counter($$anchor)');
    expect(result.code).toContain('let count = $.state(0)');
    expect(result.code).toContain('$.set(count, $.get(count) + 1)');
  });

  it('handles count++ in event handler', () => {
    const source = `component X() {
  state count = 0
  render (
    <button onclick={count++}>go</button>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('$.set(count, $.get(count) + 1)');
  });

  it('handles count-- in event handler', () => {
    const source = `component X() {
  state count = 10
  render (
    <button onclick={count--}>go</button>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('$.set(count, $.get(count) - 1)');
  });

  it('handles assignment in event handler', () => {
    const source = `component X() {
  state isOpen = false
  render (
    <button onclick={isOpen = true}>open</button>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('$.set(isOpen, true)');
  });

  it('handles bind:{name} shorthand', () => {
    const source = `component X() {
  state value = ""
  render (
    <input bind:{value} />
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('$.bindValue(el, value)');
  });

  it('preserves static attributes in template', () => {
    const source = `component X() {
  render (
    <div class="card">
      <p>hello</p>
    </div>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('class="card"');
  });

  it('handles self-closing elements', () => {
    const source = `component X() {
  render (
    <input type="text" />
    <br />
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('<input type="text"/>');
    expect(result.code).toContain('<br/>');
  });

  it('deduplicates identical templates', () => {
    const source = `component X() {
  state a = "one"
  state b = "two"
  render (
    <p>{a}</p>
    <p>{b}</p>
  )
}`;

    const result = compile(source);
    // Both <p> elements share the same template
    const matches = result.code.match(/\$\.template\(`<p> <\/p>`\)/g);
    expect(matches).toHaveLength(1);
    // But there should be two node calls
    expect(result.code).toContain('const p = $.node(');
    expect(result.code).toContain('const p_1 = $.node(');
  });

  it('does not wrap member expression properties', () => {
    const source = `component X() {
  state count = 0
  render (
    <p>{obj.count}</p>
  )
}`;

    const result = compile(source);
    // obj.count — "count" is a property, not a reactive read
    expect(result.code).toContain('obj.count');
    expect(result.code).not.toContain('obj.$.get(count)');
  });

  it('wraps computed member expression keys', () => {
    const source = `component X() {
  state idx = 0
  render (
    <p>{items[idx]}</p>
  )
}`;

    const result = compile(source);
    // items[idx] — idx is a reactive read used as computed key
    expect(result.code).toContain('$.get(idx)');
  });

  it('wraps reactive var used as method receiver', () => {
    const source = `component X() {
  state count = 0
  render (
    <p>{count.toString()}</p>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('$.get(count).toString()');
  });
});
