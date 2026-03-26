# Compiler

The DarTsx compiler transforms your components into efficient, runtime-optimized JavaScript. This document shows how the compiler transforms your code.

## How it works

The compiler performs several transformations:

1. **Syntax transformation** - Converts `state`, `derived`, `component`, and `render` keywords into standard JavaScript
2. **Template compilation** - Converts JSX into hoisted template factories, one per unique element
3. **Node factories** - Each element gets a `$.node()` call that clones the template and runs a setup function
4. **Reactivity instrumentation** - Adds granular `$.effect()` per element for tracking state dependencies
5. **Binding setup** - Generates code for two-way bindings
6. **Event delegation** - Optimizes event handlers with delegation

## Basic component compilation

### Input

```tsx
component HelloWorld() {
  state name = "world"
  state count = 0

  render (
    <h1>Hello {name}!</h1>

    <input bind:value={name} />
    <button onclick={count += 1}>
      clicks: {count}
    </button>
  )
}
```

### Output

```js
import $ from 'dartsx/internal/client';

const _h1 = $.template(`<h1> </h1>`);
const _input = $.template(`<input/>`);
const _button = $.template(`<button> </button>`);

function HelloWorld($$anchor) {
    let name = $.state("world");
    let count = $.state(0);

    const h1 = $.node(_h1, (el) => {
        const text = $.child(el);
        $.effect(() => {
            text.data = `Hello ${$.get(name) ?? ''}!`;
        });
    });
    const input = $.node(_input, (el) => {
        $.bindValue(el, name);
    });
    const button = $.node(_button, (el) => {
        const text = $.child(el);
        $.effect(() => {
            text.data = `clicks: ${$.get(count) ?? ''}`;
        });
        $.delegated('click', el, () => $.set(count, $.get(count) + 1));
    });

    $.append($$anchor, h1, input, button);
}
```

### What happened?

1. **Component declaration** - `component HelloWorld()` becomes a standard function taking an `$$anchor` node
2. **Templates hoisted** - Each unique element gets a `$.template()` factory at module scope (`_h1`, `_input`, `_button`)
3. **State** - `state` variables become `$.state()` calls
4. **Node factories** - `$.node(tmpl, setup)` clones the template and runs the setup callback with the element
5. **Granular effects** - Each element has its own `$.effect()` that only re-runs when its specific dependencies change
6. **Text updates** - `$.child(el)` grabs the text node, `text.data = ...` updates it reactively inside the effect
7. **Bindings** - `bind:value` becomes `$.bindValue(el, signal)`
8. **Events** - `onclick` becomes `$.delegated('click', el, handler)` with event delegation
9. **Append** - All elements are appended to the anchor in one call

## Derived state

### Input

```tsx
component Doubler() {
  state count = 0
  derived doubled = count * 2

  render (
    <button onclick={count++}>{count}</button>
    <p>doubled: {doubled}</p>
  )
}
```

### Output

```js
import $ from 'dartsx/internal/client';

const _button = $.template(`<button> </button>`);
const _p = $.template(`<p> </p>`);

function Doubler($$anchor) {
    let count = $.state(0);
    let doubled = $.derived(() => $.get(count) * 2);

    const button = $.node(_button, (el) => {
        const text = $.child(el);
        $.effect(() => {
            text.data = `${$.get(count) ?? ''}`;
        });
        $.delegated('click', el, () => $.set(count, $.get(count) + 1));
    });
    const p = $.node(_p, (el) => {
        const text = $.child(el);
        $.effect(() => {
            text.data = `doubled: ${$.get(doubled) ?? ''}`;
        });
    });

    $.append($$anchor, button, p);
}
```

### What happened?

1. **Derived** - `derived doubled = count * 2` becomes `$.derived(() => $.get(count) * 2)` — a lazy computed signal
2. **Increment** - `count++` is transformed to `$.set(count, $.get(count) + 1)` via AST analysis
3. **Per-element effects** - The button's effect tracks `count`, the p's effect tracks `doubled` — each re-runs independently

## Props and bind props

### Input

```tsx
export default component KeyPad(bind value, onSubmit = alert) {
  render (
    <input bind:value/>
    <button onclick={onSubmit}>submit</button>
    <p>{value}</p>
  )
}
```

### Output

```js
import $ from 'dartsx/internal/client';

const _input = $.template(`<input/>`);
const _button = $.template(`<button>submit</button>`);
const _p = $.template(`<p> </p>`);

export default function KeyPad($$anchor, $$props) {
    let value = $.prop.bind($$props, 'value');
    let onSubmit = $.prop($$props, 'onSubmit', alert);

    const input = $.node(_input, (el) => {
        $.bindValue(el, value);
    });
    const button = $.node(_button, (el) => {
        $.delegated('click', el, () => $.get(onSubmit)?.());
    });
    const p = $.node(_p, (el) => {
        const text = $.child(el);
        $.effect(() => {
            text.data = `${$.get(value) ?? ''}`;
        });
    });

    $.append($$anchor, input, button, p);
}
```

### What happened?

1. **Props** - A `$$props` parameter is added to the function signature
2. **Bind props** - `bind value` creates a two-way binding with `$.prop.bind($$props, 'value')`
3. **Default props** - `onSubmit = alert` becomes `$.prop($$props, 'onSubmit', alert)` with a default value
4. **Per-element setup** - Each element gets its own `$.node()` with bindings, events, or effects as needed
5. **Static text preserved** - The button's `"submit"` text is baked into the template, no effect needed
