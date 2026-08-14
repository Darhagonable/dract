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

2. **Cross-file functions**: The **ProjectCompiler** maintains the cross-file graph. When module A calls an imported function from module B with a signal argument, the graph records which parameter positions receive signals (a "contribution"). Module B is recompiled with the contributions merged across all callers, so its function body correctly uses `$.get()`/`$.set()`.

3. **Cross-file exports**: When a module exports `state` or `derived` variables, the graph tracks them as its **reactive exports**. When another module imports those variables, the compiler knows to treat them as signals and wraps reads/writes in `$.get()`/`$.set()`.

This means:
- **No special syntax needed** — just use `state`, `derived`, and normal function calls
- The compiler and the project layer cooperate to propagate reactivity across module boundaries
- `$.get(nonSignal)` safely returns the value as-is (passthrough), so non-reactive args are harmless
- `$.set(nonSignal, val)` safely returns `val`, so the runtime is resilient to mixed usage

### ProjectCompiler

The **ProjectCompiler** (`packages/dartsx/src/compiler/project/index.ts`) owns the entire cross-file graph: per module it tracks the source and last compiled output, resolved imports and reverse edges, reactive exports (what an importer gets as `reactiveImports`), and per-caller call contributions merged per target (what a callee gets as `reactiveCallImports`).

It is completely filesystem-agnostic. Files enter through `addFile`/`updateFile`/`removeFile`, and a file whose imports point at an id the project does not know is requested through the injected `loadFile` callback — the adapter decides where sources come from (disk for Vite, an in-memory map for the browser REPL, fixtures for tests). The compiler never touches the filesystem.

- **`updateFile(id, source)`** — the hot path (Vite transforms, playground edits). Recompiles the changed file plus everything the change invalidates, and returns `{ changed: string[] }`. Outputs are read back per id via `output(id)`; an update never copies the whole output set.
- **`compileAll()`** — the bulk path (tests, build steps). Compiles every file that has no output yet and returns `Map<string, ModuleOutput>`.
- **`output(id)`** — the current output for one id, or null.

Incremental semantics:

- An `updateFile` with unchanged source is a no-op — no file is recompiled. Unknown ids are accepted (a fresh file simply joins the project); callers never need to ask whether a file exists first.
- Editing a file's **body** recompiles that file alone: reactive exports and call contributions are source-structure facts, and while they are unchanged no importer or callee is invalidated.
- A changed reactive export set recompiles every importer (with updated `reactiveImports`); a changed contribution recompiles the affected target (with updated `reactiveCallImports`).
- A single update recompiles each (file, input-state) pair at most once — the worklist re-queues a file when its inputs changed under it, converging to a consistent graph in one call.

Each update runs in **two phases**:

1. **Analyze** — the worklist re-analyzes queued files (parse + metadata) against the current graph and reconciles it, propagating invalidation. No code is generated.
2. **Generate** — with the queue drained, every analysis is final; each file whose output is missing or was produced under different inputs is transformed exactly once.

Separating the phases means the graph's decisions run on cheap analysis metadata: a file whose inputs change twice inside one call is analyzed twice but generated once, and a file whose inputs round-trip back to a state it already generated output for is not regenerated at all.

### Vite Plugin Architecture

The Vite plugin (`@dartsx/vite-plugin`) is now a thin adapter over the ProjectCompiler — it implements none of the language semantics itself:

- **`transform`**: calls `project.updateFile(id, code)`, reads the output back through `project.output(id)`, and invalidates the `changed` neighbors in Vite's module graph so they are re-requested with their fresh output
- **`loadFile`**: reads sources from disk (`fs`) for neighbors the project discovers through sibling imports
- **`handleHotUpdate`**: calls `project.removeFile(id)` when files are deleted or renamed
- **`resolveId`/`load`**: serve extracted CSS as virtual modules (external mode only)
- Plain `.ts`/`.js` files are compiled only when they contain DarTsx syntax or the project already serves them (a DarTsx sibling pulled them in)

The browser REPL (`repl/`) uses the same ProjectCompiler with a `loadFile`-free adapter: every workspace file is pushed through `updateFile`, and outputs are read via `output(id)` for the sandbox graph and the AST panes.

### Compiler Pipeline

```
Source (.tsx/.ts)
  → Phase 1: Preprocess (custom syntax → valid TSX)
  → Phase 2: Parse (OXC parse)
  → Phase 3: Analyze (AST walk → IR + call-site analysis)
  → Phase 4: Transform (IR → output JavaScript using $.jsx() runtime)
```

Phase 1 (Preprocess) converts DarTsx keywords (`component`, `state`, `derived`, `render`, `bind`) into valid TSX.

Phase 2 (Parse) parses the preprocessed source with OXC.

Phase 3 (Analyze) walks the AST and builds an IR (Intermediate Representation). It also performs call-site analysis: for each `CallExpression`, it checks whether any arguments are reactive variables. If so, it records:
- **Local functions**: which parameter names are reactive (used during transform)
- **Imported functions**: which specifier + function name + param indices (emitted in `CompileResult.metadata.reactiveCalls` for the ProjectCompiler)

Phase 4 (Transform) converts the IR into JavaScript. JSX becomes `$.jsx()` calls, reactive reads become `$.get()`, assignments become `$.set()`, and dynamic children are wrapped in getter functions for fine-grained dependency tracking.

# Tests

use vitest
