import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler';

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

  // ── Component instantiation tests ────────────────────────────────

  it('compiles component call at root level (no props)', () => {
    const source = `component App() {
  render (
    <Child />
  )
}`;
    const result = compile(source);
    expect(result.code).toContain('Child($$anchor)');
  });

  it('compiles component call with static and dynamic props', () => {
    const source = `component App() {
  state count = 0
  render (
    <Greeting name="Alice" count={count} />
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('Greeting($$anchor, { name: () => "Alice", count: () => $.get(count) })');
  });

  it('compiles component mixed with elements at root', () => {
    const source = `component App() {
  render (
    <h1>Title</h1>
    <Child />
    <p>Footer</p>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // h1 and p should be created with $.node and appended individually
    expect(code).toContain('$.append($$anchor, h1)');
    expect(code).toContain('Child($$anchor)');
    expect(code).toContain('$.append($$anchor, p)');
  });

  it('compiles component child inside a native element', () => {
    const source = `component App() {
  render (
    <div>
      <Child />
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Template should have <!> anchor for the component
    expect(code).toContain('<div><!></div>');
    // Should navigate to the anchor and call the component
    expect(code).toContain('const anchor = $.firstChild(el)');
    expect(code).toContain('Child(anchor)');
  });

  it('compiles component between native elements', () => {
    const source = `component App() {
  render (
    <div>
      <h1>Title</h1>
      <Child />
      <p>Footer</p>
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Template: <div><h1>Title</h1><!><p>Footer</p></div>
    expect(code).toContain('<h1>Title</h1><!><p>Footer</p>');
    expect(code).toContain('const h1_el = $.firstChild(el)');
    expect(code).toContain('const anchor = $.sibling(h1_el, 1)');
    expect(code).toContain('Child(anchor)');
    expect(code).toContain('const p_el = $.sibling(anchor, 1)');
  });

  it('compiles props as getters and wraps reads in $.prop()', () => {
    const source = `export default component Greeting(name: string = "World") {
  render (
    <h1>Hello, {name}</h1>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Prop should use $.prop() with getter
    expect(code).toContain('let name = $.prop($$props.name, "World")');
    // Prop reads in template should use $.get()
    expect(code).toContain('$.get(name)');
  });

  // ── If block tests ───────────────────────────────────────────────

  it('compiles if/else block in JSX', () => {
    const source = `component App() {
  state show = true
  render (
    <div>
      {if (show) {
        <p>Visible</p>
      } else {
        <span>Hidden</span>
      }}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Template should have anchor for the if block
    expect(code).toContain('<!>');
    // Should emit $.if() call
    expect(code).toContain('$.if(');
    // Condition should wrap reactive read
    expect(code).toContain('() => $.get(show)');
    // True branch
    expect(code).toContain('<p>Visible</p>');
    // False branch
    expect(code).toContain('<span>Hidden</span>');
  });

  it('compiles if block without else', () => {
    const source = `component App() {
  state loaded = false
  render (
    <div>
      {if (loaded) {
        <p>Content</p>
      }}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(loaded)');
    // Should have true branch but no false branch
    expect(code).toContain('<p>Content</p>');
  });

  it('compiles if block at root level', () => {
    const source = `component App() {
  state show = true
  render (
    {if (show) {
      <p>Hello</p>
    }}
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.if($$anchor');
  });

  // ── For loop tests ──────────────────────────────────────────────

  it('compiles for loop in JSX', () => {
    const source = `component App() {
  state items = ["a", "b", "c"]
  render (
    <ul>
      {for (const item of items) {
        <li>{item}</li>
      }}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for(');
    expect(code).toContain('() => $.get(items)');
    expect(code).toContain('($$anchor, item) => {');
  });

  it('compiles for loop with index and key', () => {
    const source = `component App() {
  state todos = [{id: 1, text: "a"}]
  render (
    <ul>
      {for (const todo of todos; index i; key todo.id) {
        <li>{todo.text}</li>
      }}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for(');
    expect(code).toContain('($$anchor, todo, i) => {');
    expect(code).toContain('(todo) => todo.id');
  });

  it('compiles for loop at root level', () => {
    const source = `component App() {
  state items = [1, 2, 3]
  render (
    {for (const n of items) {
      <p>{n}</p>
    }}
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for($$anchor');
  });

  it('compiles for...in loop', () => {
    const source = `component App() {
  state obj = { a: 1, b: 2 }
  render (
    <ul>
      {for (const key in obj) {
        <li>{key}</li>
      }}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for(');
    // for...in converts to Object.keys()
    expect(code).toContain('Object.keys(');
    expect(code).toContain('($$anchor, key) => {');
  });

  it('compiles C-style for loop', () => {
    const source = `component App() {
  render (
    <ul>
      {for (let i = 0; i < 5; i++) {
        <li>{i}</li>
      }}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for(');
    expect(code).toContain('($$anchor, i) => {');
    // Should generate a collection-building block
    expect(code).toContain('__a.push(i)');
  });

  it('compiles C-style for loop with reactive bound', () => {
    const source = `component App() {
  state count = 5
  render (
    <ul>
      {for (let i = 0; i < count; i++) {
        <li>{i}</li>
      }}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for(');
    // Reactive bound should be wrapped in $.get()
    expect(code).toContain('$.get(count)');
  });

  it('compiles .map() with JSX', () => {
    const source = `component App() {
  state items = ["a", "b", "c"]
  render (
    <ul>
      {items.map(item => <li>{item}</li>)}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // .map() should be converted to $.for()
    expect(code).toContain('$.for(');
    expect(code).toContain('() => $.get(items)');
    expect(code).toContain('($$anchor, item) => {');
  });

  it('compiles .map() with index parameter', () => {
    const source = `component App() {
  state items = ["a", "b"]
  render (
    <ul>
      {items.map((item, i) => <li>{i}: {item}</li>)}
    </ul>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.for(');
    expect(code).toContain('($$anchor, item, i) => {');
  });

  it('compiles ternary expression with JSX', () => {
    const source = `component App() {
  state show = true
  render (
    <div>
      {show ? <p>Visible</p> : <span>Hidden</span>}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Ternary with JSX should produce $.if()
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(show)');
    expect(code).toContain('<p>Visible</p>');
    expect(code).toContain('<span>Hidden</span>');
  });

  it('compiles ternary with null alternate as if-only', () => {
    const source = `component App() {
  state show = true
  render (
    <div>
      {show ? <p>Visible</p> : null}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.if(');
    expect(code).toContain('<p>Visible</p>');
  });

  it('compiles logical && with JSX', () => {
    const source = `component App() {
  state show = true
  render (
    <div>
      {show && <p>Visible</p>}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // && with JSX should produce $.if()
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(show)');
    expect(code).toContain('<p>Visible</p>');
  });

  // ── Switch block tests ───────────────────────────────────────────

  it('compiles switch block in JSX', () => {
    const source = `component App() {
  state status = 'loading'
  render (
    <div>
      {switch (status) {
        case 'loading':
          <p>Loading...</p>
          break;
        case 'success':
          <p>Success!</p>
          break;
        default:
          <p>Unknown</p>
      }}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Template should have anchor for the switch block
    expect(code).toContain('<!>');
    // Should emit $.switch() call
    expect(code).toContain('$.switch(');
    // Discriminant should wrap reactive read
    expect(code).toContain('() => $.get(status)');
    // Case branches should be present
    expect(code).toContain('<p>Loading...</p>');
    expect(code).toContain('<p>Success!</p>');
    expect(code).toContain('<p>Unknown</p>');
    // Should have values arrays and null for default
    expect(code).toContain("values: ['loading']");
    expect(code).toContain("values: ['success']");
    expect(code).toContain('values: null');
  });

  it('compiles switch block with fall-through cases', () => {
    const source = `component App() {
  state status = 'init'
  render (
    <div>
      {switch (status) {
        case 'init':
        case 'loading':
          <p>Loading...</p>
          break;
        case 'success':
          <p>Done!</p>
          break;
      }}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.switch(');
    // Fall-through: 'init' and 'loading' should be grouped
    expect(code).toContain("values: ['init', 'loading']");
    expect(code).toContain("values: ['success']");
  });

  it('compiles switch block at root level', () => {
    const source = `component App() {
  state mode = 'a'
  render (
    {switch (mode) {
      case 'a':
        <p>A</p>
        break;
      case 'b':
        <p>B</p>
        break;
    }}
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.switch($$anchor');
  });

  // ── Try/catch block tests ────────────────────────────────────────

  it('compiles try/catch block in JSX', () => {
    const source = `component App() {
  render (
    <div>
      {try {
        <p>Content</p>
      } catch (e) {
        <p>Error occurred</p>
      }}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Template should have anchor
    expect(code).toContain('<!>');
    // Should emit $.try() call
    expect(code).toContain('$.try(');
    // Both branches should be present
    expect(code).toContain('<p>Content</p>');
    expect(code).toContain('<p>Error occurred</p>');
    // Catch parameter
    expect(code).toContain('($$anchor, e)');
  });

  it('compiles try/catch/pending block', () => {
    const source = `component App() {
  render (
    <div>
      {try {
        <p>Content</p>
      } pending {
        <p>Loading...</p>
      } catch (err) {
        <p>Failed</p>
      }}
    </div>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.try(');
    expect(code).toContain('<p>Content</p>');
    expect(code).toContain('<p>Failed</p>');
    expect(code).toContain('<p>Loading...</p>');
    // Catch parameter should be 'err'
    expect(code).toContain('($$anchor, err)');
  });

  it('compiles try block at root level', () => {
    const source = `component App() {
  render (
    {try {
      <p>Content</p>
    } catch (e) {
      <p>Error</p>
    }}
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain('$.try($$anchor');
  });
});
