# Compiler Architecture & APIs

Developer-facing documentation for `packages/dartsx`'s compiler: how the per-file
pipeline is structured, what the project layer owns, the exact public API
surface, and how each consumer (Vite plugin, browser REPL, CLI, tests) drives it.

---

## 1. Overview

The compiler is two layers:

```
┌─────────────────────────────────────────────────────────────┐
│  PROJECT LAYER (ProjectCompiler)                            │
│  composition root: ProjectGraph (records + edges)           │
│  + ProjectBuilder (worklist, two-phase run)                 │
│  + reconcile() (metadata → invalidation rules)              │
│  loadFile adapter injected for unknown ids                  │
├─────────────────────────────────────────────────────────────┤
│  PER-FILE PIPELINE (analyzeSource → generateOutput)         │
│  preprocess → oxc-transform (strip TS) → parse → analyze →  │
│  transform → remap                                          │
└─────────────────────────────────────────────────────────────┘
```

- **Per-file pipeline** — stateless: one source string in, one `CompileResult`
  out. It knows nothing about other modules except through two input options
  (`reactiveImports`, `reactiveCallImports`).
- **Project layer** — stateful, owns the graph across modules. It decides
  *when* to compile a file and *with what* inputs, and it reads the analysis
  metadata back to decide what a change invalidates.

### Package entry points (`tsdown.config.ts`)

| Import specifier               | Exports |
|--------------------------------|---------|
| `dartsx`                       | Runtime (`$.state`, `$.derived`, `$.get`, `$.set`, `$.jsx`, `$.style`, …) |
| `dartsx/compiler`              | `compile`, `analyzeSource`, `generateOutput`, `ProjectCompiler`, `preprocess` (+ `PreprocessResult`), types |
| `dartsx/compiler/preprocess`   | `preprocess`, `isDarTsxFile`, `findSuppressZones`, markers — for editor/CLI tooling that wants the preprocessor alone |
| `dartsx/jsx-runtime` etc.      | JSX runtime shims |

The generated code imports the runtime as `$` from `dartsx/internal/client`
(injected by the transform when the module needs it).

---

## 2. The per-file pipeline

```
source (.tsx/.ts)
  │
  ▼
preprocess()          DarTsx syntax → valid TSX. Emits $$s/$$d/$$style markers,
  │                   extracts component meta, <style> blocks and CSS vars,
  │                   records a source map.
  ▼
oxcTransformSync()    TS stripped by the real transpiler (enums emitted,
  │                   annotations removed) with jsx preserved. Source map
  │                   kept for the remap chain.
  ▼
parse()               OXC parse of the STRIPPED text as JSX. The tree's spans
  │                   index the stripped document — the document the transform
  │                   prints. Parse errors throw.
  ▼
analyze()             Scope tree (create_scopes), binding-kind upgrades, style
  │                   association, cross-file reactive import tracking,
  │                   call-site analysis (reactive param indices).
  │                   ── produces the metadata the graph runs on ──
  ▼
transform()           zimmerframe walk (mutates the AST) + esrap print.
  │                   JSX → $.jsx(), reads → $.get(), writes → $.set(),
  │                   CSS scoping, runtime import injection. Every node it
  │                   prints carries a svelte-style loc — preserved nodes via
  │                   attachLocations, JSX lowerings (tags, attributes, text)
  │                   via makeLoc — so esrap records a dense, per-node
  │                   source-map segment (the svelte compiler model).
  ▼
remap()               chains [esrap map, oxc-strip map, preprocess map]. The
  │                   esrap map is in stripped coordinates; oxc's strip map
  │                   lands it on the preprocessed document; the
  │                   preprocessor's map lands it on the authored source.
  │                   Precision is bounded by oxc's map, whose segments sit
  │                   at codegen node boundaries — JSX attributes collapse
  │                   into one segment each, plain statements stay per-token.
  ▼
CompileResult         { code, map, css, reactiveExports, reactiveCalls,
                        importSpecifiers, inspect? }
```

The pipeline is **split into two entry points** so the project layer can run
its graph on analysis metadata alone and defer the expensive codegen:

```ts
analyzeSource(source, options): CompileAnalysis   // parse + analyze, no codegen
generateOutput(analysis, css): CompileResult      // transform + print + remap
compile(source, options): CompileResult           // convenience = both
```

### `CompileOptions`

```ts
interface CompileOptions {
  filename?: string;                              // errors, source maps, CSS scoping
  css?: 'injected' | 'external';                  // default 'injected'
  reactiveImports?: Record<string, string[]>;     // specifier → reactive export names
  reactiveCallImports?: Record<string, number[]>; // fn name → reactive param indices
  inspect?: boolean;                              // collect position artifacts
}
```

### `CompileAnalysis`

```ts
interface CompileAnalysis {
  filename: string;
  source: string;                    // original source text
  result: AnalysisResult;            // AST + scope tree (codegen input)
  preprocessed: PreprocessResult;    // spans, maps, component meta
  strippedMap: OxcSourceMap | null;  // oxc-transform's map, chained into
                                     // codegen's remap (esrap → strip → preprocess)
  inspect: boolean;
  reactiveExports: string[];         // ─┐
  reactiveCalls: Record<...>;        //  ├─ graph metadata (what the project
  importSpecifiers: string[];        // ─┘   consumes during reconciliation)
}
```

### `CompileResult`

```ts
interface CompileResult {
  code: string;
  map: SourceMap;
  css: string;                                  // extracted CSS (external mode)
  reactiveExports: string[];
  reactiveCalls: Record<string, Record<string, number[]>>;
  importSpecifiers: string[];
  inspect?: CompileInspect;                     // when requested
}

interface CompileInspect {
  sourceAst: unknown;        // authored tree: the PREPROCESSED form parsed,
                             // spans index the preprocessed document
  generatedAst: unknown;     // the exact program that was printed
}
```

Notes:

- `generateOutput` **consumes** the analysis — the transform walk rewrites the
  AST in place. The analysis is single-use.
- `inspect` costs one extra parse of the preprocessed form; it powers the
  REPL's AST/compiled panes.
- `compile()` exists for one-off compilation (tests, tooling); the project
  layer uses the split form.

---

## 3. The project layer (`ProjectCompiler`)

`ProjectCompiler` (`packages/dartsx/src/compiler/project/index.ts`) is the
composition root of the project layer: the cross-file graph lives in
`ProjectGraph` (`project/graph.ts`), the incremental machinery in
`ProjectBuilder` (`project/builder.ts`), and the invalidation rules in
`reconcile()` (`project/reconcile.ts`). The layer is completely
filesystem-agnostic: files enter through
`addFile`/`updateFile`/`removeFile`, and unknown imports are requested through
the injected `loadFile` callback — the adapter decides where sources come from
(disk for Vite, an in-memory map for the REPL, fixtures for tests).

### Graph state

| Structure | Purpose |
|-----------|---------|
| `files: Map<id, FileRecord>` | per module: source, output, import specifiers, resolved targets, pending analysis |
| `reverseImports: Map<target, Set<caller>>` | who imports whom (reactive-export propagation) |
| `reactiveExports: Map<id, string[]>` | what a module provides to importers |
| `contributions: Map<caller, Map<target, {fn → indices}>>` | per-caller call-site contributions |
| `mergedReactiveCalls: Map<target, {fn → indices}>` | contributions merged across callers (the target's `reactiveCallImports`) |

### `ProjectCompilerOptions`

```ts
interface ProjectCompilerOptions {
  css?: 'injected' | 'external';                 // forwarded to every generate
  inspect?: boolean;                             // forwarded to every analyze
  resolveExternal?: (specifier, importerId) => string | null;  // bare/URL imports
  loadFile?: (id: string) => string | null;      // source for unknown ids
}
```

### Public API

| Method | Signature | Behavior |
|--------|-----------|----------|
| `addFile` | `(id, source): void` | Add or replace source **without compiling**. Idempotent. Nulls the stale output/metadata. Sweeps late resolutions. |
| `updateFile` | `(id, source): ProjectUpdate` | The hot path. No-op when source unchanged AND output exists. Otherwise add → enqueue → run. Throws on compile error. |
| `removeFile` | `(id): ProjectUpdate` | Drop the file, recompile affected importers and contribution targets. |
| `compileAll` | `(): Map<string, ModuleOutput>` | Bulk path (tests/build): compile everything missing an output, return the full output map. |
| `output` | `(id): ModuleOutput \| null` | Current output for one id — the only way callers read outputs. |

```ts
interface ProjectUpdate { changed: string[] }   // ids whose OUTPUT was regenerated
```

`updateFile` never copies the output set — an update returns only the ids that
changed, and callers read back per id through `output(id)`.

### The two-phase update

Every public mutation (`updateFile`, `removeFile`, `compileAll`) ends in
`run(changed)`, which executes the two phases:

```
Phase A — runAnalysis(): stabilize the graph
─────────────────────────────────────────────────────────────
  while queue is not empty:
    id = queue.shift()
    1. resolve imports
         - siblings: id + ['', '.tsx', '.ts', '.jsx', '.js']
         - unknown sibling → loadFile(id) → addFile + enqueue (joins project)
         - bare specifier → resolveExternal
    2. derive THIS file's inputs from the CURRENT graph:
         reactiveImports     = resolved targets' reactiveExports
         reactiveCallImports = mergedReactiveCalls[id]
         key = JSON.stringify([reactiveImports, reactiveCallImports])
    3. guard: skip if (id, key) already analyzed THIS call
    4. analysis = analyzeSource(source, { filename, inspect, inputs })
         record.analysis = analysis; record.analysisKey = key
    5. reconcile(record, analysis):
         - cache importSpecifiers
         - publish reactiveExports; enqueue every importer when they change
         - diff reverse edges (lastTargets) so dropped imports stop being fed
         - rebuild this caller's contributions from analysis.reactiveCalls
         - rebuild the merged registry of every affected target;
           enqueue a target when its merged registry changed

Phase B — generateOutputs(changed): codegen, once per file
─────────────────────────────────────────────────────────────
  for each file with a pending analysis:
    if output exists AND outputKey === analysisKey:  skip (output still valid)
    result = generateOutput(analysis, css)          → ModuleOutput
    record.outputKey = analysisKey; changed.push(id)
  finally: drop every record's analysis (transient)
```

Why this is cheap:

- The graph runs on **analysis metadata only** (`reactiveExports`,
  `reactiveCalls`, `importSpecifiers`) — never on generated code.
- With the queue drained, every analysis is **final**: its inputs can no longer
  change. So each file is transformed **at most once per call**, under the
  exact inputs its output should be generated under.
- A file whose inputs round-trip back to a state it already generated output
  for (`outputKey === analysisKey`) is **not regenerated at all** — generation
  is a pure function of (source, inputs).

### Incremental semantics

| Change | Recompiled |
|--------|------------|
| `updateFile` with identical source | nothing (no-op) |
| Body edit (exports/contributions unchanged) | the file alone |
| Reactive export set changed | the file + every importer |
| Contribution changed | the caller + the affected target(s) |
| `removeFile` | importers of its reactive exports, contribution targets (both directions) |
| Unknown id updated | joins the project (no `hasFile` dance) |

A single update analyzes each (file, input-state) pair at most once
(`analyzedPairs` guard); the worklist re-queues a file when its inputs changed
under it, which is how loadFile-discovered files and cascades converge in one
call.

### Error handling

- Analysis errors (parse) and codegen errors (print) throw out of the public
  method; the caller surfaces them. The failing file's output stays `null`.
- If codegen fails mid-call, the surviving `analysis` records are kept; the
  next call's `generateOutputs` regenerates them (self-healing), and a file
  whose inputs changed under a leftover analysis is re-analyzed first.

---

## 4. Cross-file reactivity mechanics

Two inputs flow into a module's compile, both decided by the graph:

**Reactive exports → `reactiveImports`.** When `store.ts` exports
`state count`, the graph records `reactiveExports['store.ts'] = ['count']`.
When `App.tsx` is analyzed, its resolved target's export list becomes
`reactiveImports: { './store': ['count'] }` — reads become `$.get(count)`,
writes become `$.set(count, v)`.

**Call contributions → `reactiveCallImports`.** When `main.ts` calls an
imported function with a signal argument, the analyzer records a contribution:
`reactiveCalls: { './utils': { watchCount: [0] } }`. The graph merges every
caller's contribution toward `utils.ts` into `mergedReactiveCalls['utils.ts']`,
which becomes the target's `reactiveCallImports` on its next analysis — its
parameter is then treated as a signal (`$.get`/`$.set` in its body) and the
call site is put in an exclusion zone (no `$.get` on the argument).

```
main.ts                       graph                        utils.ts
watchCount(count) ──contribution──► merged ──inputs──► function watchCount(c) {
                                          │                $.set(c, $.get(c)+1);
                                          └── invalidation ← contribution changed
```

Deleting `store.ts` flows reactivity **backward** too: `count` stops being a
signal, so `main.ts`'s contribution disappears, so `utils.ts` loses its
reactive param. All in one `removeFile` call.

---

## 5. Consumers

### 5.1 Vite plugin (`packages/vite-plugin`)

The plugin is a thin adapter — it implements none of the language semantics.

```ts
const project = new ProjectCompiler({
  css: cssMode,
  resolveExternal: () => null,                          // bare = external, no metadata
  loadFile: (id) => (fs.existsSync(id) ? fs.readFileSync(id, 'utf-8') : null),
});
```

`transform(code, id)` flow:

```
transform(code, id)
  ├─ extension gate: only .tsx/.jsx/.ts/.js (excl. .d.ts)
  ├─ plain ts/js gate: skip unless project.output(id)      ← "is this a project member?"
  │                      or isDarTsxSource(code)           ← "does it use DarTsx syntax?"
  ├─ project.updateFile(id, code)            (throw → this.error)
  ├─ output = project.output(id); null → bail
  ├─ for otherId in update.changed:          ← importers/callees the graph recompiled
  │      environment.moduleGraph.getModuleById(otherId).invalidateModule()
  │      so Vite re-requests their fresh output
  ├─ external css: register virtual module `${id}.css` → append `import "<cssId>";`
  └─ return { code, map: null }
```

Other hooks: `handleHotUpdate` calls `removeFile` for deleted/renamed modules;
`resolveId`/`load` serve the virtual CSS modules; `config` disables dep
discovery (`noDiscovery`) because Rolldown can't parse DarTsx syntax.

A plain `.ts`/`.js` file enters the project only when a DarTsx sibling imports
it (via `loadFile`), at which point `project.output(id)` becomes non-null and
the plugin starts compiling it on subsequent transforms.

### 5.2 Browser REPL (`repl/src/lib/playground-modules.ts`)

Same `ProjectCompiler` as Vite, in the browser (the compiler is pure
JS/WASM — oxc-parser/oxc-transform wasm + esrap, no Node APIs). Configured
with `inspect: true` so the AST/compiled panes read the parsed trees off the
outputs without recompiling.

```ts
const project = new ProjectCompiler({ css: 'injected', inspect: true });
```

`buildModuleGraph(files, entry)` flow (called on every compile in the
playground, debounced per edit):

```
buildModuleGraph(files, entry)
  ├─ validate: entry exists, names unique
  ├─ ensureCompiled(files)
  │     ├─ projectFiles diff → project.removeFile(stragglers)
  │     └─ for each file (skipping .react.tsx):
  │           project.updateFile(name, source)   (throw → compileErrors map)
  ├─ es-module-lexer: parse each compiled output's import spans
  ├─ rewriteAndRecord per module:
  │     './File'          → __pg_module:<name>__ token (sandbox swaps for blob URL)
  │     dartsx/react      → left bare (sandbox import map)
  │     https://esm.sh/*  → verbatim
  │     bare              → https://esm.sh/<id>?external=dartsx
  ├─ DFS topo-sort from entry (post-order = dependencies first)
  └─ modules: [{ name, code }] for the sandbox + panes
```

Outputs are read through `getModuleOutput(name) → project.output(name)`; a
compile error leaves the file without an output, and the pane surfaces
`compileError(name)`. `.react.tsx` React-host files bypass the project
entirely (sucrase compiles them, memoized).

### 5.3 CLI (`packages/cli`)

The CLI never runs `compile()` or `ProjectCompiler` — it ships DarTsx **source**
and lets the consumer's Vite plugin compile it at dev/build time. It only
touches `dartsx/compiler/preprocess`:

- **`dartsx build` / `watch`**: scans and classifies files with `isDarTsxFile`.
  DarTsx `.tsx` ships as-is (import extensions rewritten); plain `.ts`/`.tsx`
  is transpiled (types stripped via tsc); `.d.ts` emitted through
  `dartsxToTsx` + tsc; everything else is copied.
- **`dartsx check`**: `proxyCreateProgram` with the DarTsx language plugin
  (`@dartsx/typescript-plugin/language`) for real type-checking, plus unused-
  CSS analysis. Uses `isDarTsxFile` and `findSuppressZones` from
  `dartsx/compiler/preprocess` to suppress known false positives.

So the compiler's two surfaces are consumed by different tools:
`preprocess` by the editor/language tooling, `compiler` by build/runtime
tooling (Vite + REPL).

### 5.4 Tests

- `packages/dartsx/tests/compiler/snapshot.test.ts` — the bulk path: per sample
  directory, `addFile` each source, `project.compileAll()` → output `Map`,
  compare against `_expected/` (regenerate with `UPDATE_SNAPSHOTS=true`).
- `packages/dartsx/tests/compiler/incremental.test.ts` — pins the incremental
  contract: no-op on identical source, body edits spare neighbors, export
  changes cascade to importers, contribution changes recompile targets,
  `removeFile` cascades both directions, and update-by-update compilation
  converges to the same output as `compileAll`.

---

## 6. File map

| File | Role |
|------|------|
| `packages/dartsx/src/compiler/index.ts` | Pipeline split (`analyzeSource`/`generateOutput`/`compile`) + public types |
| `packages/dartsx/src/compiler/project/index.ts` | `ProjectCompiler`: thin composition root (public API, option molding) |
| `packages/dartsx/src/compiler/project/graph.ts` | `ProjectGraph`: records, edges (reverse imports, reactive exports, contributions, merged calls) — pure data |
| `packages/dartsx/src/compiler/project/builder.ts` | `ProjectBuilder`: worklist, import resolution, two-phase analyze→generate run |
| `packages/dartsx/src/compiler/project/reconcile.ts` | `reconcile()`: metadata → graph mutations + invalidation rules |
| `packages/dartsx/src/compiler/phases/1-preprocess` | DarTsx syntax → TSX, markers, component meta, CSS extraction (public subpath) |
| `packages/dartsx/src/compiler/phases/2-parse` | OXC parse wrapper |
| `packages/dartsx/src/compiler/phases/3-analyze` | Scopes, bindings, call-site analysis, metadata |
| `packages/dartsx/src/compiler/phases/4-transform` | zimmerframe walk, CSS scoping, esrap print, `attachLocations`/`makeLoc` locs |
| `packages/dartsx/src/compiler/factory.ts` / `scope.ts` | AST builders, scope tree |
