# Deep Reactivity — How It All Works

This document explains the internals of the reactivity system: how signals and proxies work, how the compiler transforms your code, and how reactivity flows across functions and module boundaries.

## Primitives vs objects

The `state` keyword produces different runtime representations depending on the initial value:

| Declaration | Runtime value | Read/write |
|:---|:---|:---|
| `state count = 0` | A `Signal<number>` object | Compiler uses `$.get(count)` / `$.set(count, val)` |
| `state obj = { x: 1 }` | A reactive `Proxy` | Direct property access (`obj.x`) is already reactive |
| `state arr = [1, 2]` | A reactive `Proxy` (array) | `arr.push(3)` and `arr[0] = 5` both trigger updates |

The compiler emits `$.state(initialValue)`, which internally decides:

```
$.state(0)            → Signal { v: 0, version: 0, subs: Set {} }
$.state({ x: 1 })    → Proxy (per-property signals, version signal, root signal)
$.state(new Map(...)) → Proxy (per-key signals)
$.state(new Set(...)) → Proxy (version signal)
$.state(new Date())   → Proxy (single signal)
```

## Signals

A `Signal` is the fundamental unit of reactivity. It holds a value (`v`), a `version` counter, and a set of subscribers:

```typescript
interface Signal<T> {
    v: T;
    version: number;
    subs: Set<Subscriber>;
}
```

- **`$.get(signal)`** reads the current value. If called inside a reactive context (a `derived` computation or an internal effect), the current subscriber is added to the signal's `subs` set — this is _dependency tracking_.
- **`$.set(signal, value)`** writes a new value. If the value is referentially different (`!Object.is(old, new)`), it bumps the version, then walks all subscribers notifying them they're dirty. A microtask is scheduled to flush effects.
- **Passthrough safety**: `$.get(nonSignal)` returns the value as-is. `$.set(nonSignal, val)` returns `val`. This means the compiler can safely wrap reads/writes without runtime checks.

### The SIGNAL brand

Every Signal and DerivedSignal is branded with a `Symbol('signal')` property. This lets the runtime distinguish signal objects from proxied objects (which look like ordinary objects to `typeof`).

## Derived signals

A `DerivedSignal` extends `Signal` with a computation function:

```typescript
interface DerivedSignal<T> extends Signal<T> {
    fn: () => T;
    dirty: boolean;
    initialized: boolean;
}
```

Derived values use **push-pull reactivity**:

1. **Push**: When an upstream signal changes, the derived is _marked dirty_ immediately (the "push"). The dirtiness propagates transitively — if derived `B` depends on derived `A`, and `A` depends on signal `s`, changing `s` marks both `A` and `B` dirty.
2. **Pull**: The derived is only _re-evaluated_ when something actually reads it (`getDerived()`). If the new result is referentially identical to the old one, the version is not bumped and downstream subscribers are not scheduled.

This means chains of deriveds that produce the same value are short-circuited — the UI only updates when the final result actually changes.

## Proxies — per-property signals

When `state` receives an object or array, it creates a `Proxy` with a **per-property signal map**. Each property has its own lazy signal:

```
state obj = { name: 'alice', age: 30 }
         ↓ $.state({ name: 'alice', age: 30 })
         ↓ proxy({ name: 'alice', age: 30 })

Proxy internals:
  sources: Map {
    'name' → Signal { v: 'alice' },  ← created on first read of obj.name
    'age'  → Signal { v: 30 },       ← created on first read of obj.age
  }
  version: Signal { v: 0 }   ← bumped on structural changes (add/delete key)
  root:    Signal { v: 0 }   ← bumped on ANY mutation (for effect subscriptions)
```

**Reading** `obj.name` creates a signal for `'name'` (if not yet created), tracks it in the current subscriber, and returns the value.

**Writing** `obj.name = 'bob'` updates the signal's value, notifies its subscribers, and also bumps the `root` signal. The `root` lets an `effect(obj, cb)` fire on _any_ change to the object.

**Structural changes** like adding or deleting properties bump the `version` signal. Iteration (`Object.keys`, `for...in`) tracks the version signal so iteration-based code re-runs when the shape changes.

### Deep nesting and parentRoot

Proxies are recursive — assigning an object or array as a property automatically proxies the child:

```
state data = { user: { name: 'alice' } }
// proxy creates:
//   outer proxy (root signal R1)
//     → child proxy for { name: 'alice' } (root signal R2, parentRoot = R1)
```

Each child proxy receives its parent's `root` signal as `parentRoot`. When a child mutation occurs (e.g., `data.user.name = 'bob'`), the child calls `notifyRoots()` which bumps both its own root _and_ the parent root. This bubbles all the way up, so `effect(data, cb)` fires on deeply nested mutations.

### Array proxies

Arrays use the same `proxyObject` path as plain objects. Array methods like `push`, `splice`, and index assignment all go through the `set` trap, which updates per-index signals and bumps root/version signals.

### Map proxies

Map proxies use **per-key signals** (lazily created) plus a version signal for size/iteration:

- `map.get(key)` — tracks the per-key signal
- `map.set(key, value)` — notifies the per-key signal + root
- `map.delete(key)` — notifies the per-key signal + version + root
- `map.size`, `map.forEach()`, iterators — track the version signal

### Set proxies

Set proxies use a single **version signal** that is bumped on `add`, `delete`, and `clear`. Reading (`has`, `size`, iteration) tracks the version signal.

### Date proxies

Date proxies use a single signal. Any `set*` method (`setFullYear`, `setTime`, etc.) bumps the signal. Any read method (`getFullYear`, `toLocaleString`, etc.) tracks it.

### Unwrapping

The `RAW` symbol retrieves the original unproxied object: `obj[RAW]` returns the underlying plain object. The `STATE_SYMBOL` brand lets the runtime detect proxied objects (e.g., to avoid double-proxying, or to resolve proxy → root signal for effects).

## Effect scheduling

Effects are batched via a microtask. When a signal is set:

1. All downstream subscribers are marked `dirty = true` synchronously (the "push")
2. Each dirty subscriber is added to `pendingEffects`
3. A single `Promise.resolve().then(flushEffects)` is scheduled (if not already scheduled)
4. When the microtask runs, all pending effects execute

This means multiple synchronous state changes in a row produce only **one** effect flush:

```tsx
state a = 1;
state b = 2;

effect([a, b], ...);

a = 10; // marks dirty, schedules flush
b = 20; // already scheduled — just marks dirty
// → effect runs once with a=10, b=20
```

`tick()` returns a promise that resolves after the pending flush completes (or immediately if nothing is pending).

## The compiler pipeline

The compiler transforms `.tsx` source files through three phases:

### Phase 1 — Preprocess

Converts custom keywords into valid TSX that OXC can parse:

| Source | Preprocessed |
|:---|:---|
| `component Counter()` | `function Counter()` |
| `state count = 0` | `let count = 0` |
| `derived doubled = count * 2` | `const doubled = count * 2` |
| `render (...)` | `return (<>...</>)` |
| `bind:{x}` | `bind:value={x}` |
| `{if (cond) <jsx />}` | `{__if(() => (cond), () => (<>...</>))}` |

The preprocessor also records metadata: which names are state vars, which are derived vars, and which functions are components.

### Phase 2 — Analyze

Walks the OXC AST and produces an IR (Intermediate Representation) for each component and for the module as a whole. Key responsibilities:

- **`reactiveVars`**: Collects all names that are reactive (state + derived + bind props + cross-file imports)
- **`walkCallSites`**: Walks the entire AST to detect calls like `myFunc(reactiveVar)`. When a reactive variable is passed as an argument, the function's parameter at that position is recorded as reactive
- **`reactiveCallTargets`**: Maps function names → sets of reactive parameter indices. This tells the transformer which call arguments must NOT be unwrapped with `$.get()` (because the callee expects a signal)
- **`reactiveCalls`**: Records cross-file reactive call info (specifier → function → indices) so the Vite plugin can recompile target modules

### Phase 3 — Transform

Generates the output JavaScript. Key transformations:

#### State and derived declarations

```
state count = 0     →  let count = $.state(0);
derived doubled = count * 2  →  const doubled = $.derived(() => $.get(count) * 2);
```

#### Reactive reads and writes

In any expression where a reactive variable appears:

```
count         →  $.get(count)           // read
count = 5     →  $.set(count, 5)        // write
count++       →  $.set(count, $.get(count) + 1)  // update
count += x    →  $.set(count, $.get(count) + x)  // compound assignment
```

**Member expressions on reactive objects** are _not_ wrapped at the property level — the proxy handles member access natively:

```
obj.name      →  $.get(obj).name  ← compiler wraps the root only
// Wait — for proxied objects, $.get(proxy) returns the proxy as-is (passthrough).
// So this is equivalent to just: obj.name
// But the compiler wraps the root because obj *could* be a signal if reassigned.
```

#### Exclusion zones

Some call arguments must remain as raw signal objects (not unwrapped via `$.get()`):

1. **Effect dependencies**: The first argument of `effect(count, cb)` must be the signal itself, not `$.get(count)`
2. **Reactive function arguments**: If a function is known to receive a signal at position N, the argument at that position stays as-is

The compiler detects these _exclusion zones_ and skips `$.get()` wrapping for identifiers inside them.

#### Derived wrapping for member expressions

When a member expression on a reactive proxy appears in a signal-expected position, the compiler wraps it in `$.derived()`:

```tsx
// Source:
effect(obj.count, (val) => console.log(val))

// Compiled:
effect($.derived(() => obj.count), (val) => console.log(val))
```

This is needed because `obj.count` evaluates to a plain value (a number), not a signal. Wrapping it in `$.derived()` creates a `DerivedSignal` that re-evaluates whenever `obj.count` changes — giving the effect a proper signal to subscribe to.

This wrapping applies to **all** signal-expected positions, not just `effect()`:

```tsx
// Source (watchCount has reactive param at position 0):
watchCount(obj.count)

// Compiled:
watchCount($.derived(() => obj.count))
```

## How reactivity flows across functions

### Same-file functions

When the compiler sees a reactive variable passed to a local function:

```tsx
function double(value: number) {
  return value * 2;
}

state count = 5;
derived d = double(count);
```

The **call-site analysis** (`walkCallSites`) detects that `double(count)` passes a signal at position 0. The function `double` is then recompiled with `value` as a reactive parameter:

```javascript
// Output:
function double(value) {
  return $.get(value) * 2;
}

let count = $.state(5);
const d = $.derived(() => double(count));  // count passed as signal
```

Notice: at the call site, `count` stays as `count` (no `$.get()`), because the call analysis added it to `reactiveCallTargets`, which creates an exclusion zone. The signal object is passed directly to the function.

### Cross-file functions (via Vite plugin)

When a signal is passed to an _imported_ function, the compiler can't recompile the target in the same compilation pass. Instead, the **Vite plugin** coordinates:

1. **Caller compiles**: The compiler detects `watchCount(count)` passes a signal at position 0. It records this in `reactiveCalls`: `{ './utils': { watchCount: [0] } }`.

2. **Plugin stores**: The Vite plugin resolves `'./utils'` to an absolute path, and stores the contribution: `reactiveCallContributions[callerId][targetId] = { watchCount: [0] }`.

3. **Plugin aggregates**: It rebuilds the aggregated `reactiveCallRegistry` for the target module by merging all callers' contributions.

4. **Plugin invalidates**: If the registry changed, it invalidates the target module in Vite's module graph, triggering a recompile.

5. **Target recompiles**: When `utils.ts` is recompiled, the plugin passes `reactiveCallImports: { watchCount: [0] }` to the compiler. The analyzer sees this and treats `watchCount`'s parameter 0 as reactive, adding it to `reactiveCallTargets`.

6. **Argument wrapping**: At the call site in the caller, `reactiveCallTargets` ensures the argument at position 0 is in an exclusion zone (no `$.get()`) and, if it's a member expression on a proxy, wraps it in `$.derived()`.

### Cross-file reactive exports

Exported `state` and `derived` variables are also tracked:

```tsx
// store.ts
export state count = 0;   // → reactiveExports: ['count']
```

The Vite plugin stores `reactiveRegistry[resolvedId] = ['count']`. When another module imports `count`:

```tsx
// App.tsx
import { count } from './store';
```

The plugin passes `reactiveImports: { './store': ['count'] }` to the compiler. The analyzer adds `count` to `moduleReactiveVars`, so reads become `$.get(count)` and writes become `$.set(count, val)`.

### Positional union

If a function is called from multiple sites with different reactive arguments:

```tsx
test(signal, plain)   // → position 0 is reactive
test(plain, signal)   // → position 1 is reactive
```

The compiler takes the **union** of all reactive positions. Both parameters are treated as reactive — reads become `$.get()`, writes become `$.set()`. This is safe because `$.get(nonSignal)` and `$.set(nonSignal, val)` are no-ops.

## The user-facing effect

The `effect()` function accepts signals, derived signals, or proxies as dependencies:

```tsx
effect(count, (val, prevVal) => { ... })         // single signal
effect(obj, (val, prevVal) => { ... })            // proxy (watches any change)
effect(derivedVal, (val, prevVal) => { ... })     // derived signal
effect([a, b], ([a, prevA], [b, prevB]) => { ... })  // multiple deps
```

Internally, `effect()` resolves each dependency:

- **Signal/DerivedSignal** (detected via `SIGNAL` brand) → subscribes directly
- **Proxy** (detected via `STATE_SYMBOL` brand) → looks up the proxy's `root` signal via `getProxySignal()` and subscribes to it

The callback receives current values (for signals, the unwrapped value; for proxies, the proxy itself) and previous values.

### How old/new value tracking works

The effect uses **closure-captured snapshots** to track previous values. Here's the mechanism for a single dependency:

```typescript
// Simplified effect internals (single dep):
const sig = resolveSignal(dep);   // get the Signal to subscribe to
let oldVal = readDep(dep);        // ← snapshot the current value at creation time

const sub: Subscriber = {
    run() {
        const newVal = readDep(dep);      // read the current value NOW
        callback(newVal, oldVal);          // pass both to the callback
        oldVal = newVal;                   // ← update the snapshot for next run
    },
    // ...
};

sig.subs.add(sub);   // subscribe to the signal
sub.run();           // initial run (oldVal === newVal on first call)
```

The key insight: `oldVal` is a **mutable closure variable** that is updated _after_ each callback invocation. When the signal changes and the effect re-runs, `oldVal` still holds the value from the _previous_ run, while `readDep(dep)` reads the _current_ value.

For **multiple dependencies**, the same pattern uses an array:

```typescript
// Simplified effect internals (multi dep):
let oldVals = deps.map(readDep);      // snapshot all current values

const sub: Subscriber = {
    run() {
        const newVals = deps.map(readDep);
        const pairs = deps.map((_, i) => [newVals[i], oldVals[i]]);
        callback(...pairs);               // each pair is [newVal, oldVal]
        oldVals = newVals;                // update snapshots for next run
    },
};
```

`readDep()` does different things depending on the dependency type:
- **Signal/DerivedSignal** → calls `get(sig)` to unwrap the current value
- **Proxy** → returns `dep[RAW]` (the raw underlying target, not the proxy)

For old-value tracking, a separate `snapshotDep()` function is used:
- **Signal/DerivedSignal** → same as `readDep()` (unwraps the current value)
- **Proxy** → calls `structuredClone(dep[RAW])` to deep-clone the raw target

Both `newVal` and `oldVal` are plain objects (not proxies). The difference is that `newVal` is the live raw target (reflects the current state), while `oldVal` is a `structuredClone` snapshot frozen at the previous run. This lets you compare `oldObj.count !== newObj.count` meaningfully.

### Accessing new and old values

#### Single dependency

With a single dependency, the callback receives the new value as the first argument and the previous value as the second:

```tsx
state count = 0;

effect(count, (newVal, oldVal) => {
  console.log(`count: ${oldVal} → ${newVal}`);
});

count = 5;  // logs: "count: 0 → 5"
```

For proxy dependencies, both `newVal` and `oldVal` are **plain objects** (not proxies). `newVal` is the raw target (current state), while `oldVal` is a **deep snapshot** (`structuredClone`). This means you can compare old and new state:

```tsx
state obj = { x: 1, y: 2 };

effect(obj, (newObj, oldObj) => {
  if (oldObj.x !== newObj.x) {
    console.log(`x changed from ${oldObj.x} to ${newObj.x}`);
  }
});

obj.x = 10;  // logs: "x changed from 1 to 10"
```

> [!NOTE] Both old and new values for proxy deps are plain objects (not proxies). Old values are created via `structuredClone` on the raw target; new values are the raw target directly. This supports objects, arrays, Maps, Sets, and Dates.

#### Multiple dependencies

With an array of dependencies, the callback receives one `[newVal, oldVal]` pair per dependency:

```tsx
state firstName = "Alice";
state lastName = "Smith";

effect([firstName, lastName], ([firstName, prevFirstName], [lastName, prevLastName]) => {
  console.log(`Name changed: ${prevFirstName} ${prevLastName} → ${firstName} ${lastName}`);
});

firstName = "Bob";  // logs: "Name changed: Alice Smith → Bob Smith"
```

Each pair argument corresponds to the dependency at the same index in the deps array.

#### Nested property dependencies

When watching a nested property via a member expression, the effect receives the property value (not the whole object):

```tsx
state user = { name: "Alice", age: 30 };

effect(user.name, (name, prevName) => {
  console.log(`name: ${prevName} → ${name}`);
});

user.name = "Bob";  // logs: "name: Alice → Bob"
user.age = 31;      // does NOT fire — only watching user.name
```

#### Initial run

Effects run immediately on creation with the current value as both `newVal` and `oldVal`:

```tsx
state count = 5;

effect(count, (newVal, oldVal) => {
  console.log(newVal, oldVal);
});
// logs: 5, 5  (initial run)

count = 10;
// logs: 10, 5  (after tick)
```

### Nested property watching

To watch a specific property of a proxied object, use a member expression:

```tsx
state obj = { count: 0 };

effect(obj.count, (count, prevCount) => {
  console.log(`changed from ${prevCount} to ${count}`);
});
```

The compiler transforms `obj.count` in the dep position into `$.derived(() => obj.count)`, creating a derived signal that tracks only that property. The effect subscribes to this derived, so it fires only when `obj.count` changes — not when other properties of `obj` change.

## Lifecycle overview

1. **Component initialization**: The component function runs once. `$.state()` creates signals/proxies, `$.derived()` creates lazy deriveds, `$.prop()` creates deriveds from incoming props.

2. **Mounting**: The `jsx()` runtime creates real DOM nodes. Dynamic children are wrapped in `() => $.get(count)` — anonymous functions that are called inside an internal effect, establishing subscriptions.

3. **Updates**: When state changes, signals notify subscribers → deriveds are marked dirty → effects are scheduled → microtask flushes → deriveds are re-evaluated on read → DOM updates.

4. **Cleanup**: `onCleanup()` / `onDestroy()` callbacks run when the component is unmounted.

## Design invariants

- **No virtual DOM**: The `jsx()` runtime creates real DOM elements directly. Updates are surgical — only the affected text nodes or attributes change.
- **No auto-tracking in user effects**: `effect(dep, cb)` always requires explicit dependencies. Auto-tracking is only used internally (e.g., derived computations, JSX child expressions).
- **Same-value optimization**: Setting a signal/proxy property to the same value (`Object.is`) is a no-op — no notifications, no re-renders.
- **Safe passthrough**: `$.get()` and `$.set()` gracefully handle non-signal values, so the compiler can be aggressive with wrapping without risking runtime errors.
