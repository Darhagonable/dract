# Compiler

The DarTsx compiler transforms your components into efficient, runtime-optimized JavaScript. This document shows how the compiler transforms your code.

## How it works

The compiler performs several transformations:

1. **Syntax transformation** — Converts `component`, `state`, `derived`, `render`, and `bind` keywords into standard JavaScript
2. **JSX compilation** — Converts JSX into `$.jsx()` runtime calls with fine-grained reactivity
3. **Reactivity instrumentation** — Wraps reactive reads in `$.get()`, assignments in `$.set()`, and expressions in getter functions for dependency tracking
4. **Binding setup** — Generates prop keys for two-way bindings (`"bind:value"` on elements, raw signals on components)
5. **Event delegation** — Optimizes event handlers with delegation
6. **Control flow** — Transforms `{if}`, `{for}`, `{switch}`, `{try}` blocks into runtime calls

## Basic component compilation

### Input

```tsx
component Counter() {
  state count = 0

  render (
    <button onclick={count++}>{count}</button>
  )
}
```

### Output

```js
import $ from 'dartsx/internal/client';

function Counter() {
    let count = $.state(0);

    return $.jsx("button", {
        onclick: () => $.set(count, $.get(count) + 1),
        children: [() => $.get(count)]
    });
}
```

### What happened?

1. **Component declaration** — `component Counter()` becomes a standard function
2. **State** — `state count = 0` becomes `let count = $.state(0)`
3. **JSX** — The `<button>` becomes `$.jsx("button", { ... })` with props and children
4. **Event handler** — `count++` is transformed to `() => $.set(count, $.get(count) + 1)` — the compiler detects the mutation and wraps it
5. **Dynamic children** — `{count}` becomes `() => $.get(count)` — a getter function so the runtime can re-evaluate it when the signal changes
6. **Return** — `render (...)` becomes `return ...`

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

function Doubler() {
    let count = $.state(0);
    const doubled = $.derived(() => $.get(count) * 2);

    return $.jsx($.Fragment, { children: [
        $.jsx("button", {
            onclick: () => $.set(count, $.get(count) + 1),
            children: [() => $.get(count)]
        }),
        $.jsx("p", {
            children: ["doubled: ", () => $.get(doubled)]
        })
    ] });
}
```

### What happened?

1. **Derived** — `derived doubled = count * 2` becomes `const doubled = $.derived(() => $.get(count) * 2)` — a lazy computed signal
2. **Fragment** — Multiple root elements are wrapped in `$.jsx($.Fragment, { children: [...] })`
3. **Mixed children** — Static text `"doubled: "` is passed as-is, dynamic `{doubled}` becomes a getter `() => $.get(doubled)`
4. **Increment** — `count++` is transformed to `$.set(count, $.get(count) + 1)` via AST analysis

## Props and bind props

### Input

```tsx
export default component KeyPad(bind value, onSubmit = alert) {
  render (
    <input bind:value={value} />
    <button onclick={onSubmit()}>submit</button>
    <p>{value}</p>
  )
}
```

### Output

```js
import $ from 'dartsx/internal/client';

export default function KeyPad($$props) {
    let value = $.prop.bind($$props, 'value');
    const onSubmit = $.prop($$props, 'onSubmit', alert);

    return $.jsx($.Fragment, { children: [
        $.jsx("input", { "bind:value": value }),
        $.jsx("button", {
            onclick: () => $.get(onSubmit)(),
            children: ["submit"]
        }),
        $.jsx("p", {
            children: [() => $.get(value)]
        })
    ] });
}
```

### What happened?

1. **Props** — A `$$props` parameter is added to the function signature
2. **Bind props** — `bind value` creates a two-way binding with `let value = $.prop.bind($$props, 'value')` — note `let` not `const`, since the signal is writable
3. **Default props** — `onSubmit = alert` becomes `const onSubmit = $.prop($$props, 'onSubmit', alert)` with a default value
4. **Element binding** — `bind:value={value}` becomes `"bind:value": value` — the runtime reads this key and sets up two-way binding
5. **Static text preserved** — The button's `"submit"` text is passed as a plain string, no getter needed
6. **Prop reads** — `onSubmit()` becomes `$.get(onSubmit)()` — unwrap the signal then call it
