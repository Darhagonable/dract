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

    // Should have function declaration (no $$anchor)
    expect(code).toContain('function HelloWorld()');

    // Should have state declarations
    expect(code).toContain('let name = $.state("world");');
    expect(code).toContain('let count = $.state(0);');

    // Should have derived declaration with $.get() wrapping
    expect(code).toContain('const doubled = $.derived(() => $.get(count) * 2);');

    // Should return a fragment with jsx() children
    expect(code).toContain('return $.jsx($.Fragment');
    expect(code).toContain('$.jsx("h1"');
    expect(code).toContain('$.jsx("input"');
    expect(code).toContain('$.jsx("button"');
    expect(code).toContain('$.jsx("p"');

    // Reactive children wrapped in getters
    expect(code).toContain('() => $.get(name)');
    expect(code).toContain('() => $.get(count)');
    expect(code).toContain('() => $.get(doubled)');

    // Should have bind:value
    expect(code).toContain('"bind:value": name');

    // Should have click event with transformed assignment
    expect(code).toContain('onclick: () => $.set(count, $.get(count) + 1)');
  });

  it('compiles export default component', () => {
    const source = `export default component Greeting(name: string = "World") {
  render (
    <h1>Hello, {name}</h1>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('export default function Greeting($$props)');
    expect(result.code).toContain("$.prop($$props, 'name', \"World\")");
  });

  it('compiles export component', () => {
    const source = `export component Counter() {
  state count = 0
  render (
    <button onclick={count++}>{count}</button>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('export function Counter()');
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
    expect(result.code).toContain('"bind:value": value');
  });

  it('passes bind:prop as raw signal on components', () => {
    const source = `component Parent() {
  state name = "hello"
  render (
    <Child bind:name={name} />
  )
}`;

    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // Component should get the raw signal, not "bind:name"
    expect(code).toContain('Child({ name: name })');
    expect(code).not.toContain('"bind:name"');
  });

  it('supports bind keyword in component param declarations', () => {
    const source = `component Keypad(readonlyProp, bind value) {
  render (
    <p>{value}</p>
  )
}`;

    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // bind param should compile to $.prop.bind()
    expect(code).toContain("const readonlyProp = $.prop($$props, 'readonlyProp')");
    expect(code).toContain("let value = $.prop.bind($$props, 'value')");
    // Should NOT contain __bind__ prefix in output
    expect(code).not.toContain('__bind__');
  });

  it('supports bind keyword with default value in param', () => {
    const source = `component Keypad(bind value = "fallback") {
  render (
    <p>{value}</p>
  )
}`;

    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain("let value = $.prop.bind($$props, 'value', \"fallback\")");
    expect(code).not.toContain('__bind__');
  });

  it('compiles renamed props (string parameters)', () => {
    const source = `component RenamedProps(
  'required-renamed' as foo: number,
  'optional-with-default' as baz: number = 3,
) {
  render (
    <div>{foo} {baz}</div>
  )
}`;

    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    // External name is used as the prop key, local name for the variable
    expect(code).toContain("const foo = $.prop($$props, 'required-renamed')");
    expect(code).toContain("const baz = $.prop($$props, 'optional-with-default', 3)");
    // Local names should be used in the JSX output
    expect(code).toContain('$.get(foo)');
    expect(code).toContain('$.get(baz)');
  });

  it('preserves static attributes in jsx props', () => {
    const source = `component X() {
  render (
    <div class="card">
      <p>hello</p>
    </div>
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('class: "card"');
  });

  it('handles self-closing elements', () => {
    const source = `component X() {
  render (
    <input type="text" />
    <br />
  )
}`;

    const result = compile(source);
    expect(result.code).toContain('$.jsx("input", { type: "text" })');
    expect(result.code).toContain('$.jsx("br")');
  });

  it('emits jsx for duplicate element types', () => {
    const source = `component X() {
  state a = "one"
  state b = "two"
  render (
    <p>{a}</p>
    <p>{b}</p>
  )
}`;

    const result = compile(source);
    // Both <p> elements are separate $.jsx() calls
    const matches = result.code.match(/\$\.jsx\("p"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
    expect(result.code).toContain('() => $.get(a)');
    expect(result.code).toContain('() => $.get(b)');
  });

  it('does not wrap member expression properties', () => {
    const source = `component X() {
  state count = 0
  render (
    <p>{obj.count}</p>
  )
}`;

    const result = compile(source);
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
    expect(result.code).toContain('return Child()');
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
    expect(code).toContain('Greeting({ name: () => "Alice", count: () => $.get(count) })');
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
    expect(code).toContain('return $.jsx($.Fragment');
    expect(code).toContain('$.jsx("h1"');
    expect(code).toContain('Child()');
    expect(code).toContain('$.jsx("p"');
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
    expect(code).toContain('$.jsx("div"');
    expect(code).toContain('Child()');
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
    expect(code).toContain('$.jsx("div"');
    expect(code).toContain('$.jsx("h1"');
    expect(code).toContain('Child()');
    expect(code).toContain('$.jsx("p"');
  });

  it('compiles props as getters and wraps reads in $.prop()', () => {
    const source = `export default component Greeting(name: string = "World") {
  render (
    <h1>Hello, {name}</h1>
  )
}`;
    const result = compile(source);
    const code = normalizeWhitespace(result.code);
    expect(code).toContain("const name = $.prop($$props, 'name', \"World\")");
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
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(show)');
    expect(code).toContain('$.jsx("p", { children: ["Visible"] })');
    expect(code).toContain('$.jsx("span", { children: ["Hidden"] })');
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
    expect(code).toContain('$.jsx("p", { children: ["Content"] })');
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
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(show)');
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
    expect(code).toContain('(item) =>');
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
    expect(code).toContain('(todo, i) =>');
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
    expect(code).toContain('$.for(');
    expect(code).toContain('() => $.get(items)');
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
    expect(code).toContain('Object.keys(');
    expect(code).toContain('(key) =>');
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
    expect(code).toContain('(i) =>');
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
    expect(code).toContain('$.for(');
    expect(code).toContain('() => $.get(items)');
    expect(code).toContain('(item) =>');
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
    expect(code).toContain('(item, i) =>');
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
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(show)');
    expect(code).toContain('$.jsx("p"');
    expect(code).toContain('$.jsx("span"');
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
    expect(code).toContain('$.jsx("p"');
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
    expect(code).toContain('$.if(');
    expect(code).toContain('() => $.get(show)');
    expect(code).toContain('$.jsx("p"');
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
    expect(code).toContain('$.switch(');
    expect(code).toContain('() => $.get(status)');
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
    expect(code).toContain('$.switch(');
    expect(code).toContain('() => $.get(mode)');
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
    expect(code).toContain('$.try(');
    expect(code).toContain('$.jsx("p", { children: ["Content"] })');
    expect(code).toContain('$.jsx("p", { children: ["Error occurred"] })');
    expect(code).toContain('(e) =>');
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
    expect(code).toContain('(err) =>');
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
    expect(code).toContain('$.try(');
    expect(code).toContain('(e) =>');
  });
});
