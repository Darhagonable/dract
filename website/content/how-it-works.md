---
title: How It Works
---

# How It Works

This page explains the compiler pipeline and runtime architecture.

## Compiler pipeline

The compiler transforms `.tsx` files through four phases:

### Phase 1 — Preprocess

Custom keywords are converted to valid TypeScript so the parser (OXC) can process them:

| Source | Parsed as |
|:---|:---|
| `component Counter()` | `function Counter()` |
| `state count = 0` | `let count = 0` |
| `derived doubled = count * 2` | `const doubled = count * 2` |
| `render (...)` | `return (<>...</>)` |

### Phase 2 — Parse

The preprocessed source is parsed with OXC into an AST.

### Phase 3 — Analyze

The AST is walked to build an intermediate representation:

- **Reactive vars** — all `state`, `derived`, and bindable prop names are collected
- **Call-site analysis** — function calls like `fn(reactiveVar)` are detected. The parameter position is recorded as reactive
- **Cross-file tracking** — reactive imports and exports are recorded for the Vite plugin

### Phase 4 — Transform

The final JavaScript is generated:

```tsx
// Source
state count = 0;
derived doubled = count * 2;
render <p>{count}</p>

// Output
let count = $.state(0);
const doubled = $.derived(() => $.get(count) * 2);
return $.jsx('p', { children: [() => $.get(count)] });
```

## Signal system

Signals are the fundamental unit of reactivity:

```typescript
interface Signal<T> {
  v: T;          // current value
  version: number;
  subs: Set<Subscriber>;
}
```

- `$.get(signal)` reads the value and subscribes the current context
- `$.set(signal, value)` writes the value, bumps version, and notifies subscribers
- Both are safe no-ops on non-signal values

## Proxies

Objects and arrays are wrapped in proxies with per-property signals. Reading a property creates a lazy signal. Writing a property updates that signal. Mutations bubble up through parent roots.

## Effect scheduling

State changes are batched. Multiple synchronous updates produce one flush:

```tsx
state a = 1;
state b = 2;
a = 10; // marks effects dirty, schedules microtask
b = 20; // already scheduled, just marks dirty
// → effects run once with a=10, b=20
```

`tick()` returns a promise that resolves after the flush.

## Push-pull reactivity

1. **Push** — When a signal changes, all dependents are immediately marked dirty
2. **Pull** — Derived values are only recomputed when actually read
3. **Short-circuit** — If a derived produces the same value, downstream dependents are not notified

## Cross-module coordination

The Vite plugin coordinates reactivity across files:

1. Caller compiles → detects `fn(signal)` → records `{ targetModule: { fn: [0] } }`
2. Plugin stores the contribution and aggregates all callers
3. If the registry changed, the target module is invalidated and recompiled
4. Target recompiles with the reactive parameter info → wraps reads/writes in signal accessors

This is fully automatic — no annotations needed.
