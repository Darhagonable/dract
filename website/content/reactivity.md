---
title: Reactivity
---

# Reactivity

## state

The `state` keyword creates reactive variables. When state changes, the UI updates automatically.

```tsx
export component Counter() {
  state count = 0;

  render (
    <button onclick={() => count++}>
      clicks: {count}
    </button>
  )
}
```

There is no special API — `count` is just a number. Update it like any variable.

### Deep state

When `state` is used with objects or arrays, the result is a deeply reactive proxy:

```tsx
state todos = [{ done: false, text: 'learn DarTsx' }];

// All of these trigger updates:
todos[0].done = true;
todos.push({ done: false, text: 'build app' });
```

Maps, Sets, and Dates are also reactive:

```tsx
state scores = new Map([['alice', 10]]);
scores.set('bob', 20); // triggers update

state tags = new Set(['react']);
tags.add('dartsx'); // triggers update

state now = new Date();
now.setTime(Date.now()); // triggers update
```

> Destructuring a reactive value produces non-reactive copies. Use property access to stay reactive.

## derived

Derived state recomputes automatically when its dependencies change:

```tsx
state count = 0;
derived doubled = count * 2;
derived message = `Count is ${count}, doubled is ${doubled}`;
```

Derived expressions should be side-effect free. The framework recalculates them lazily — only when read.

### Destructured derived

Destructuring with `derived` makes each variable reactive:

```tsx
derived { x, y } = getPosition();
// equivalent to:
// derived _pos = getPosition();
// derived x = _pos.x;
// derived y = _pos.y;
```

## effect

Effects run side effects when dependencies change. Import `effect` from `dartsx`:

```tsx
import { effect } from 'dartsx';

state count = 0;

effect(count, (newVal, oldVal) => {
  console.log(`${oldVal} → ${newVal}`);
});
```

### Multiple dependencies

```tsx
effect([a, b], ([a, prevA], [b, prevB]) => {
  console.log(`a: ${prevA}→${a}, b: ${prevB}→${b}`);
});
```

### Cleanup

Use `onCleanup` inside an effect to run cleanup before re-execution:

```tsx
import { effect, onCleanup } from 'dartsx';

effect(query, (q) => {
  const ctrl = new AbortController();
  fetch(`/search?q=${q}`, { signal: ctrl.signal });
  onCleanup(() => ctrl.abort());
});
```

## Passing state to functions

The compiler detects when you pass state to a function and transforms both the call site and the function body so reactivity flows through:

```tsx
function double(value: number) {
  return value * 2;
}

state count = 5;
derived d = double(count); // d updates when count changes
```

This works across module boundaries too — the Vite plugin coordinates recompilation of imported functions when they receive reactive arguments.

## Cross-module state

Export state from any module. The compiler and Vite plugin track reactive exports automatically:

```tsx
// store.ts
export state count = 0;
export function increment() { count++; }

// App.tsx
import { count, increment } from './store';
// count is reactive here — reads/writes are compiled to $.get/$.set
```

The Vite plugin maintains a registry of reactive exports. When a module imports them, the compiler wraps reads and writes in signal accessors.

## Deep reactivity

### Primitives vs objects

| Declaration | Runtime | Reactive via |
|:---|:---|:---|
| `state count = 0` | Signal | `$.get()` / `$.set()` |
| `state obj = { x: 1 }` | Proxy | Property access/assignment |
| `state arr = [1, 2]` | Proxy | Index access, `.push()`, etc. |
| `state m = new Map()` | Proxy | `.get()`, `.set()`, `.delete()` |
| `state s = new Set()` | Proxy | `.add()`, `.delete()`, `.has()` |
| `state d = new Date()` | Proxy | `.setTime()`, etc. |

### Per-property signals

Object proxies create a lazy signal for each property. Only properties that are actually read get tracked:

```tsx
state user = { name: 'Alice', age: 30 };

// Reading user.name creates a signal for 'name'
// Only UI that reads user.name updates when it changes
user.name = 'Bob'; // updates only name-dependent nodes
```

### Nested objects

Assigning an object as a property automatically wraps it in a proxy:

```tsx
state data = { user: { name: 'Alice' } };
data.user.name = 'Bob'; // triggers updates at all levels
```

Mutations bubble upward — an `effect(data, cb)` fires on any nested change.

### Arrays

Array methods work naturally:

```tsx
state items = ['a', 'b'];

items.push('c');      // triggers update
items[0] = 'z';       // triggers update
items.splice(1, 1);   // triggers update
```

### Maps and Sets

```tsx
state scores = new Map([['alice', 10]]);
scores.set('bob', 20);     // per-key signal + root signal
scores.delete('alice');     // per-key signal + version signal

state tags = new Set(['react']);
tags.add('dartsx');         // bumps version signal
tags.has('react');          // tracks version signal
```

### Dates

```tsx
state now = new Date();
now.setTime(Date.now());      // bumps single signal
now.toLocaleTimeString();     // tracks single signal
```

## Update propagation

DarTsx uses push-pull reactivity. When state changes, dependents are immediately marked dirty (push), but derived values are only recalculated when read (pull). If a derived produces the same value, downstream updates are skipped.
