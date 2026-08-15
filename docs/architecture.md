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
const onSubmit = $.prop($$props, 'onSubmit', alert);
```

### Cross-file reactivity

A key design goal is that **the signal (proxy object) is always passed** — never the raw value — when state flows between functions and modules. The compiler uses **call-site analysis** to achieve this automatically:

1. **Same-file functions**: The compiler walks the AST for `CallExpression` nodes. When a `state` or `derived` variable is passed as an argument, the compiler marks that parameter position as reactive and transforms the function body to use `$.get()`/`$.set()` for that parameter.

2. **Cross-file functions**: The `Project` compiler layer (`dartsx/compiler/project`) maintains a registry of reactive call information. When module A calls an imported function from module B with a signal argument, the project records which parameter positions receive signals. Module B is then recompiled with that information, so its function body correctly uses `$.get()`/`$.set()`.

3. **Cross-file exports**: When a module exports `state` or `derived` variables, the project tracks them. When another module imports those variables, the compiler knows to treat them as signals and wraps reads/writes in `$.get()`/`$.set()`.

This means:
- **No special syntax needed** — just use `state`, `derived`, and normal function calls
- The compiler and the `Project` layer cooperate to propagate reactivity across module boundaries
- `$.get(nonSignal)` safely returns the value as-is (passthrough), so non-reactive args are harmless
- `$.set(nonSignal, val)` safely returns `val`, so the runtime is resilient to mixed usage

### Project Layer

Cross-file reactive state lives in the compiler package (`dartsx/compiler/project`), keeping it tooling-agnostic. The `Project` class accepts the single-file `compile()` output plus injected `resolve`/`readFile` hooks and tracks:

- **`reactiveRegistry`**: Maps module IDs → exported reactive variable names
- **`reactiveCallRegistry`**: Maps module IDs → which function params receive signals from callers
- **`importSpecifierCache`**: Caches import specifiers from compile results (avoids regex parsing)
- **`pendingInvalidations`**: Guards against recompilation loops between mutually importing files
- **`update()`**: Compiles a module, stores its output, replaces its reactive-call contributions, rebuilds affected targets, and returns the ids whose outputs changed by the call
- **`output(id)`**: The project owns compiled outputs; tools read results back instead of receiving them per call
- **`remove()`**: Cleans up project state (including outputs) when files are deleted or renamed

Tools feed modules into `Project` and act on the results. The Vite plugin (`@dartsx/vite-plugin`) is a thin adapter: it supplies vite's `resolve` and the filesystem as hooks, invalidates the returned module IDs through the vite module graph, and handles CSS delivery.

### Compiler Pipeline

```
Source (.tsx/.ts)
  → Phase 1: Preprocess (custom syntax → valid TSX)
  → Phase 2: Parse (OXC parse)
  → Phase 3: Analyze (AST walk → IR + call-site analysis)
  → Phase 4: Transform (IR → output JavaScript using $.jsx() runtime)
```

Phase 1 (Preprocess) rewrites DarTsx keywords (`component`, `state`, `derived`, `render`, `bind`) into valid TSX.

Phase 2 (Parse) parses the preprocessed TSX with OXC.

Phase 3 (Analyze) walks the AST and builds an IR (Intermediate Representation). It also performs call-site analysis: for each `CallExpression`, it checks whether any arguments are reactive variables. If so, it records:
- **Local functions**: which parameter names are reactive (used during transform)
- **Imported functions**: which specifier + function name + param indices (emitted in `CompileResult.metadata.reactiveCalls` for the Project layer)

Phase 4 (Transform) converts the IR into JavaScript. JSX becomes `$.jsx()` calls, reactive reads become `$.get()`, assignments become `$.set()`, and dynamic children are wrapped in getter functions for fine-grained dependency tracking.

# Tests

use vitest