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
  onMount(() => {
    const interval = setInterval(() => {
      now.setTime(Date.now());
    }, 1000);

    onCleanup(() => clearInterval(interval));
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

State in this framework is different — when you pass a `state` variable to a function, the compiler detects this at the call site and automatically transforms the function to work with the underlying signal. You don't need any special annotation:

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

Under the hood, the compiler sees that `add(a, b)` passes two reactive variables. It transforms the function body so that `a` and `b` are read with `$.get()` and written with `$.set()`. The signal objects are passed directly — never the raw values — so the function always sees the current state.

This works for any function, not just ones in the same file. The compiler and ProjectCompiler cooperate to track which parameter positions receive signals across module boundaries (see [Passing state across modules](#passing-state-across-modules)).

> [!NOTE] Only parameters at positions where a reactive variable is actually passed will be transformed. If a parameter only ever receives plain values, it stays untouched. The runtime is also safe — `$.get(nonSignal)` returns the value as-is, and `$.set(nonSignal, val)` returns `val`.

## Passing state across modules

State flows naturally across module boundaries — no special syntax required. You can export `state` and `derived` variables, and the compiler's project layer will automatically track them:

```tsx
// @filename: store.ts
export state count = 0;

export function increment() {
  count += 1;
}
```

```tsx
// @filename: App.tsx
import { count, increment } from './store';

export default component App() {
  render (
    <button onclick={increment}>
      clicks: {count}
    </button>
  );
}
```

This works because the ProjectCompiler tracks reactive exports across the module graph. When `store.ts` is compiled, the project records that `count` is reactive. When `App.tsx` is compiled against that, the compiler knows to wrap reads in `$.get()` and writes in `$.set()`.

### Cross-file function calls

When you pass state to an imported function, the compiler detects this at the call site and the project recompiles the target module with the merged contributions:

```tsx
// @filename: helpers.ts
export function double(value: number) {
  return value * 2;
}

export function reset(value: number) {
  value = 0;
}
```

```tsx
// @filename: App.tsx
import { double, reset } from './helpers';

export default component App() {
  state count = 5;
  derived doubled = double(count);

  render (
    <button onclick={() => reset(count)}>
      {count} × 2 = {doubled}
    </button>
  );
}
```

The compiler sees that `double(count)` and `reset(count)` pass a signal at position 0. The project records this and recompiles `helpers.ts` so that `value` is treated as reactive — reads become `$.get(value)` and assignments become `$.set(value, 0)`.

> [!NOTE] This analysis is positional. If a function is called from multiple sites, the union of all reactive positions is used. For example, if `test(signal, plain)` is called in one place and `test(plain, signal)` in another, both parameters are treated as reactive.

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
