use oxc for the compiler

fully typescript 

pnpm because monorepo


no virtual dom

## Reactivity Model

The framework uses **signals** via `state` and `derived` keywords. They can be used anywhere — inside components, at module level, or in shared utility files.

The compiler transforms reactive declarations into signal operations:

```tsx
// Source
state name = "world";
state count = 0;
derived doubled = count * 2;
```

```js
// Compiled output
import $ from 'dartsx/internal/client';

let name = $.state("world");
let count = $.state(0);
let doubled = $.derived(() => $.get(count) * 2);
```

Reading and writing state is compiled to `$.get()` and `$.set()`:

```js
$.get(count)        // read
$.set(count, 1)     // write
$.get(doubled)      // read derived
```

Component props are wrapped in `$.prop()` which returns a derived signal:

```js
let value = $.prop.bind($$props, 'value');
let onSubmit = $.prop($$props, 'onSubmit', alert);
```

### Cross-file reactivity

A key design goal is that **the signal (proxy object) is always passed** — never the raw value — when state flows between functions and modules. The compiler uses **call-site analysis** to achieve this automatically:

1. **Same-file functions**: The compiler walks the AST for `CallExpression` nodes. When a `state` or `derived` variable is passed as an argument, the compiler marks that parameter position as reactive and transforms the function body to use `$.get()`/`$.set()` for that parameter.

2. **Cross-file functions**: The Vite plugin maintains a registry of reactive call information. When module A calls an imported function from module B with a signal argument, the plugin records which parameter positions receive signals. Module B is then recompiled with that information, so its function body correctly uses `$.get()`/`$.set()`.

3. **Cross-file exports**: When a module exports `state` or `derived` variables, the Vite plugin tracks them. When another module imports those variables, the compiler knows to treat them as signals and wraps reads/writes in `$.get()`/`$.set()`.

This means:
- **No special syntax needed** — just use `state`, `derived`, and normal function calls
- The compiler and Vite plugin cooperate to propagate reactivity across module boundaries
- `$.get(nonSignal)` safely returns the value as-is (passthrough), so non-reactive args are harmless
- `$.set(nonSignal, val)` safely returns `val`, so the runtime is resilient to mixed usage

### Vite Plugin Architecture

The Vite plugin (`dartsx-vite-plugin`) is essential for cross-file reactivity:

- **`reactiveRegistry`**: Maps module IDs → exported reactive variable names
- **`reactiveCallRegistry`**: Maps module IDs → which function params receive signals from callers
- **`importSpecifierCache`**: Caches import specifiers from compile results (avoids regex parsing)
- **`pendingInvalidations`**: Guards against recompilation loops between mutually importing files
- **`handleHotUpdate`**: Cleans up stale registry entries when files are deleted or renamed
- **Module invalidation**: When new reactive call info is discovered, affected modules are invalidated and recompiled

### Compiler Pipeline

```
Source (.tsx/.ts)
  → Phase 1: Preprocess (custom syntax → valid TSX)
  → Phase 2: Parse (OXC)
  → Phase 3: Analyze (AST walk → IR + call-site analysis)
  → Phase 4: Transform (IR → output JavaScript)
```

Phase 3 (Analyze) performs call-site analysis by walking the full AST. For each `CallExpression`, it checks whether any arguments are reactive variables. If so, it records:
- **Local functions**: which parameter names are reactive (used during transform)
- **Imported functions**: which specifier + function name + param indices (emitted in `CompileResult.reactiveCalls` for the Vite plugin)

# Tests

use vitest