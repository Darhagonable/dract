# Reactivity

## state

The `state` keyword allows you to create _reactive state_, which means that your UI _reacts_ when it changes.

```tsx
export component Counter() {
  state count = 0;

  render (
    <button onclick={() => count++}>
      clicks: {count}
    </button>
  );
}
```

Unlike other frameworks you may have encountered, there is no API for interacting with state — `count` is just a number, rather than an object or a function, and you can update it like you would update any other variable.

### Deep state

If `state` is used with an array or a simple object, the result is a deeply reactive _state proxy_. [Proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) allow the framework to run code when you read or write properties, including via methods like `array.push(...)`, triggering granular updates.

State is proxified recursively until the framework finds something other than an array or simple object (like a class or an object created with `Object.create`). In a case like this...

```tsx
state todos = [
  {
    done: false,
    text: 'add more todos'
  }
];
```

...modifying an individual todo's property will trigger updates to anything in your UI that depends on that specific property:

```tsx
state todos = [{ done: false, text: 'add more todos' }];

todos[0].done = !todos[0].done;
```

If you push a new object to the array, it will also be proxified:

```tsx
state todos = [{ done: false, text: 'add more todos' }];

todos.push({
  done: false,
  text: 'eat lunch'
});
```

Note that if you destructure a reactive value, the references are not reactive — as in normal JavaScript, they are evaluated at the point of destructuring:

```tsx
state todos = [{ done: false, text: 'add more todos' }];

let { done, text } = todos[0];

// this will not affect the value of `done`
todos[0].done = !todos[0].done;
```

### Built-in reactive types

In addition to objects and arrays, `state` also makes [`Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map), [`Set`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set), and [`Date`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) reactive. Reading from these types (or checking their size) in a derived state or effect will cause re-evaluation when they are mutated.

#### Map

State-declared `Map` objects react to `set`, `delete`, and `clear` operations:

```tsx
export component Scoreboard() {
  state scores = new Map([
    ['alice', 10],
    ['bob', 20]
  ]);

  derived total = Array.from(scores.values()).reduce((a, b) => a + b, 0);

  render (
    <button onclick={() => scores.set('alice', 100)}>update alice</button>
    <button onclick={() => scores.delete('bob')}>delete bob</button>
    <p>total: {total}</p>
  );
}
```

#### Set

State-declared `Set` objects react to `add`, `delete`, and `clear` operations:

```tsx
export component TagManager() {
  state tags = new Set(['react', 'svelte']);

  derived count = tags.size;

  render (
    <button onclick={() => tags.add('vue')}>add vue</button>
    <button onclick={() => tags.delete('svelte')}>delete svelte</button>
    <p>count: {count}</p>
    <p>has react: {tags.has('react')}</p>
  );
}
```

#### Date

State-declared `Date` objects react when you call any of the `set` methods:

```tsx
export component Clock() {
  state now = new Date();

  // Update every second
  effect(() => {
    const interval = setInterval(() => {
      now.setTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  });

  render (
    <p>Time: {now.toLocaleTimeString()}</p>
  );
}
```

> [!NOTE] Values stored in reactive Maps, Sets, and Dates are _not_ themselves made reactive. If you need deep reactivity for stored objects, wrap them in `state` when inserting them.

## Passing state into functions

JavaScript is a _pass-by-value_ language — when you call a function, the arguments are the _values_ rather than the _variables_.

```tsx
function add(a: number, b: number) {
  return a + b;
}

let a = 1;
let b = 2;
let total = add(a, b);
console.log(total); // 3

a = 3;
b = 4;
console.log(total); // still 3!
```

If `add` wanted to have access to the _current_ values of `a` and `b`, and to return the current `total` value, you would need to use functions instead:

```tsx
function add(getA: () => number, getB: () => number) {
  return () => getA() + getB();
}

let a = 1;
let b = 2;
let total = add(() => a, () => b);
console.log(total()); // 3

a = 3;
b = 4;
console.log(total()); // 7
```

State in this framework is different — when you reference something declared with `state`, it will always be ractive.

Note that 'functions' is broad — it encompasses properties of proxies and [`get`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get)/[`set`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/set) properties...

```tsx
function add(a: number, b: number) {
  return a + b;
}

state a = 1;
state b = 2;
derived total = add(a, b);
console.log(total); // 3

a = 3;
b = 4;
console.log(total); // 7
```

## Passing state across modules

You can declare state in shared files, but you can only _export_ that state if it's not directly reassigned. In other words you can't do this:

```tsx
export state count = 0;

export function increment() {
  count += 1;
}
```

That's because every reference to `count` is transformed by the Svelte compiler — the code above is roughly equivalent to this:

```js
export let count = $.state(0);

export function increment() {
  $.set(count, $.get(count) + 1);
}
```

Since the compiler only operates on one file at a time, if another file imports `count` Svelte doesn't know that it needs to wrap each reference in `$.get` and `$.set`:

```js
// @filename: state.svelte.js
export state count = 0;

// @filename: index.js
import { count } from './state.svelte.js';

console.log(typeof count); // 'object', not 'number'
```

This framework comes with a handy solution to this by introducing state imports similar to how typescript has type imports. This will let framework know that it needs to wrap each reference in `$.get` and `$.set`:

```js
// @filename: state.svelte.js
export state count = 0;

// @filename: index.js
import { state count } from './state.svelte.js';

console.log(typeof count); // 'object', not 'number'
```
## derived

Derived state is declared with the `derived` keyword:

```tsx
export component Doubler() {
  state count = 0;
  derived doubled = count * 2;

  render (
    <button onclick={() => count++}>
      {doubled}
    </button>
  );
}
```

The expression should be free of side-effects. The framework will disallow state changes (e.g. `count++`) inside derived expressions.

> [!NOTE] Code in this framework components is only executed once at creation. Without the `derived` keyword, `doubled` would maintain its original value even when `count` changes.

## Understanding dependencies

Anything read synchronously inside the `derived` expression is considered a _dependency_ of the derived state. When the state changes, the derived will be recalculated when it is next read.

## Deriveds and reactivity

Unlike `state`, which converts objects and arrays to deeply reactive proxies, `derived` values are left as-is. For example, in a case like this...

```js
state items = [ /*...*/ ];

state index = 0;
derived selected = items[index];
```

...you can change (or `bind:` to) properties of `selected` and it will affect the underlying `items` array. If `items` was _not_ deeply reactive, mutating `selected` would have no effect.

## Destructuring

If you use destructuring with a `derived` keyword, the resulting variables will all be reactive — this...

```js
function stuff() { return { a: 1, b: 2, c: 3 } }

derived { a, b, c } = stuff();
```

...is roughly equivalent to this:

```js
function stuff() { return { a: 1, b: 2, c: 3 } }

derived _stuff = stuff();
derived a = _stuff.a;
derived b = _stuff.b;
derived c = _stuff.c;
```

## effect

Use `effect` to run side effects when state changes. Effects are useful for logging, DOM manipulation, API calls, or any other side effects that should occur in response to state changes.

```tsx
import { effect } from 'this-framework';

export component CountLogger() {
  state count = 0;

  effect(count, (count, prevCount) => {
    console.log(`Count changed from ${prevCount} to ${count}`);
  });

  render (
    <button onclick={() => count++}>
      clicks: {count}
    </button>
  );
}
```

### Effects on deep state

You can watch nested properties of reactive objects:

```tsx
import { effect } from 'this-framework';

export component ObjectLogger() {
  state obj = { count: 0 };

  effect(obj.count, (count, prevCount) => {
    console.log(`obj.count changed from ${prevCount} to ${count}`);
  });

  render (
    <button onclick={() => obj.count++}>
      Increment
    </button>
  );
}
```

### Watching multiple sources

When watching multiple sources, the callback receives arrays containing new and old values corresponding to the source array:

```tsx
import { effect } from 'this-framework';

export component MultiLogger() {
  state foo = "foo";
  state bar = "bar";

  effect([foo, bar], ([foo, prevFoo], [bar, prevBar]) => {
    console.log(`foo: ${prevFoo} -> ${foo}, bar: ${prevBar} -> ${bar}`);
  });

  render (
    <div>
      <button onclick={() => foo = foo + "o"}>More foo</button>
      <button onclick={() => bar = bar + "a"}>More bar</button>
    </div>
  );
}
```

### Effect cleanup

Use `onCleanup` to register a cleanup function that will be executed when the current effect is about to re-run or when the component unmounts.

```tsx
import { effect, onCleanup } from 'this-framework';

export component ResizeListener() {
  state width = window.innerWidth;

  effect(() => {
    const handleResize = () => {
      width = window.innerWidth;
    };

    window.addEventListener('resize', handleResize);

    onCleanup(() => {
      window.removeEventListener('resize', handleResize);
    });
  });

  render (
    <div>Window width: {width}px</div>
  );
}
```

## Update propagation

The framework uses something called _push-pull reactivity_ — when state is updated, everything that depends on the state (whether directly or indirectly) is immediately notified of the change (the 'push'), but derived values are not re-evaluated until they are actually read (the 'pull').

If the new value of a derived is referentially identical to its previous value, downstream updates will be skipped. In other words, the framework will only update the text inside the button when `large` changes, not when `count` changes, even though `large` depends on `count`:

```tsx
export component LargeCounter() {
  state count = 0;
  derived large = count > 10;

  render (
    <button onclick={() => count++}>
      {large}
    </button>
  );
}
```
