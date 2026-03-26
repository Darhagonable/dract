# Compiler

The DarTsx compiler transforms your components into efficient, runtime-optimized JavaScript. This document shows how the compiler transforms your code.

## How it works

The compiler performs several transformations:

1. **Syntax transformation** - Converts `state`, `derived`, `component`, and `render` keywords into standard JavaScript
2. **Template compilation** - Converts JSX into efficient template functions
3. **Reactivity instrumentation** - Adds tracking for state dependencies and effects
4. **Binding setup** - Generates code for two-way bindings
5. **Event delegation** - Optimizes event handlers with delegation

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
import * as $ from 'dartsx/internal/client';

export default function App($$anchor) {
    var root = $.template(`<h1> </h1> <input/> <button> </button>`, 1);

    let name = $.state('world');
    let count = $.state(0);

    var fragment = root();
    var h1 = $.firstChild(fragment);
    var text = $.child(h1);
    var input = $.sibling(h1, 2);
    var button = $.sibling(input, 2);
    var text_1 = $.child(button);

    $.templateEffect(() => {
        $.setText(text, `Hello ${$.get(name) ?? ''}!`);
        $.setText(text_1, `clicks: ${$.get(count) ?? ''}`);
    });

    $.bindValue(input, name);
    $.delegated('click', button, () => $.set(count, $.get(count) + 1));
    $.append($$anchor, fragment);
}
```

### What happened?

1. **Component declaration** - `component HelloWorld()` becomes a standard function
2. **State** - `state` variables become `$.state()` calls
3. **Template** - JSX is parsed into a template string with placeholder positions
4. **DOM navigation** - `$.firstChild`, `$.child`, `$.sibling` navigate the template without queries
5. **Reactive text** - `$.templateEffect` wraps reactive expressions
6. **Bindings** - `bind:value` becomes `$.bindValue`
7. **Events** - `onclick` becomes `$.delegated` with event delegation

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
import * as $ from 'dartsx/internal/client';

export default function Keypad($$anchor, $$props) {
    var root = $.template(`<input/> <button>submit</button> <p> </p>`, 1);

    let value = $.prop($$props.value);
    let onSubmit = $.prop($$props.onSubmit, alert);

    var fragment = root();
    var input = $.firstChild(fragment);

    var button = $.sibling(input, 2);
    var p = $.sibling(button, 2);
    var text = $.child(p, true);

    $.templateEffect(() => $.set_text(text, $.get(value)));

    $.bindValue(input, value);
    $.delegated('click', button, function (...$args) {
        $.get(onSubmit)?.apply(this, $args);
    });

    $.append($$anchor, fragment);
}
```

### What happened?

1. **Props** - A `$props` parameter is added
2. **Bind props** - `bind value` creates a two-way binding with `$.prop($props.value)`
3. **Default props** - `onSubmit = alert` becomes a default value in `$.prop($props.onSubmit, alert)`
4. **Optional chaining** - `$.get(onSubmit)?.apply()` safely handles optional callbacks
5. **Event args** - Event handlers receive spread arguments `...$args`

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
import * as $ from 'dartsx/internal/client';

export default function Doubler($$anchor) {
    var root = $.template(`<button> </button> <p> </p>`, 1);

    let count = $.state(0);
    let doubled = $.derived(() => $.get(count) * 2);

    var fragment = root();
    var button = $.firstChild(fragment);
    var text = $.child(button);
    var p = $.sibling(button, 2);
    var text_1 = $.child(p, true);

    $.templateEffect(() => {
        $.setText(text, `${$.get(count) ?? ''}`);
        $.setText(text_1, `doubled: ${$.get(doubled) ?? ''}`);
    });

    $.delegated('click', button, () => $.set(count, $.get(count) + 1));
    $.append($$anchor, fragment);
}
```
