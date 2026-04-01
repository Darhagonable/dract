# DarTsx Tooling Specification

## 1. Scope

DarTsx tooling currently ships as a TypeScript-plugin-first stack:

- `packages/typescript-plugin` provides editor intelligence inside DarTsx source and in TypeScript files that import DarTsx modules.
- `packages/vscode-plugin` registers the TypeScript plugin and injects DarTsx syntax highlighting into TypeScript and TSX editors.
- `packages/vite-plugin` compiles DarTsx source for dev/build and propagates cross-file reactivity metadata.
- `packages/dartsx` remains the source of truth for compiler and runtime behavior.

There is no standalone DarTsx language server in the current architecture. Editor features are delivered through tsserver plus the DarTsx TypeScript plugin.

## 2. Syntax Surface Area

DarTsx source can live in `.tsx` files and, for non-JSX modules, `.ts` files that use DarTsx declarations.

### Keywords
| Syntax | Example | What plain TS sees |
|---|---|---|
| `component Name(props)` | `export default component Counter()` | Invalid TypeScript keyword usage |
| `state x = val` | `state count = 0` | Invalid TypeScript keyword usage |
| `derived x = expr` | `derived doubled = count * 2` | Invalid TypeScript keyword usage |
| `render (...)` | `render (<div />)` | Invalid in function body |
| `async component` | `async component Foo()` | Invalid keyword combination |

### JSX Extensions
| Syntax | Example | What plain TS sees |
|---|---|---|
| `bind:property={expr}` | `<input bind:value={name} />` | Invalid JSX attribute name |
| `bind:{ident}` | `<input bind:{value} />` | Invalid shorthand syntax |
| `bind:property={get, set}` | `<input bind:value={() => v, (v) => x = v} />` | Invalid JSX expression form |

### Parameters
| Syntax | Example |
|---|---|
| `bind` in params | `component Input(bind value: string)` |
| Renamed props | `component Card('display-name' as displayName: string)` |
| Bindable renamed props | `component Card(bind 'display-name' as displayName: string)` |

### Inline Control Flow
| Syntax | Example |
|---|---|
| `{if (cond) { <jsx /> }}` | `{if (x) { <p>yes</p> } else { <p>no</p> }}` |
| `{switch (val) { case ...: <jsx /> }}` | `{switch (status) { case 'ok': <p>OK</p> break; }}` |
| `{for (const x of items) { ... }}` | `{for (const item of list) { <li>{item}</li> }}` |
| `{try { <jsx /> } catch (e) { <jsx /> }}` | `{try { <Body /> } catch (e) { <ErrorView /> }}` |
| `{try { <jsx /> } pending { <jsx /> } catch { ... }}` | Suspense-style flow |

## 3. Tooling Goals

### 3.1 Required Behavior

1. Opening DarTsx source must not crash tsserver or the VS Code extension.
2. Non-DarTsx `.ts` and `.tsx` files must keep normal TypeScript behavior.
3. Hover, go-to-definition, completions, and diagnostics must remain usable inside DarTsx source.
4. DarTsx-specific syntax must not surface obvious false-positive TypeScript diagnostics.
5. Cross-file imports from DarTsx modules must preserve useful type information for consumers.
6. Production and dev builds must compile the same DarTsx syntax the editor understands.

### 3.2 Quality Targets

1. Source positions should map back to the original DarTsx file closely enough for normal navigation and hover.
2. DarTsx-native concepts should be visible in editor UI where practical, even when the underlying TS view is lowered syntax.
3. Build-time reactivity propagation should work across modules without requiring users to annotate imports manually.

## 4. Current Architecture

### 4.1 Overview

```
┌────────────────────────────────────────────────────┐
│ VS Code Extension (packages/vscode-plugin)        │
│ - Registers the TypeScript server plugin          │
│ - Injects TextMate grammar into TS and TSX        │
│ - Shows lightweight editor status UI              │
└───────────────────────────┬────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────┐
│ TypeScript Server + DarTsx TS Plugin              │
│ (packages/typescript-plugin)                      │
│ - Detects DarTsx source by content                │
│ - Builds Volar virtual code from DarTsx source    │
│ - Rewrites hover labels to DarTsx-native terms    │
│ - Filters false-positive diagnostics              │
└───────────────────────────┬────────────────────────┘
                            │
                ┌───────────▼───────────┐
                │ DarTsx-to-TSX Lowering │
                │ - MagicString edits    │
                │ - Volar code mappings  │
                └───────────┬───────────┘
                            │
┌───────────────────────────▼────────────────────────┐
│ Compiler + Vite Plugin                             │
│ (packages/dartsx, packages/vite-plugin)            │
│ - Compile DarTsx for runtime                       │
│ - Track reactive exports/imports across files      │
│ - Recompile dependent modules when call sites move │
└────────────────────────────────────────────────────┘
```

### 4.2 Why This Shape

DarTsx uses TypeScript-owned file extensions. That makes a Svelte-style split language-server architecture less attractive because tsserver already owns `.ts` and `.tsx` files and users still expect standard TS behavior in mixed files.

The current design keeps a single TypeScript service in charge and layers DarTsx support into it:

- Volar virtual code handles source mapping and transformed service code.
- The DarTsx plugin only activates for files that actually contain DarTsx syntax.
- Regular TypeScript files continue through the normal TS pipeline unchanged.
- The build stack stays separate and uses the real compiler instead of the editor-only lowering.

## 5. Editor Tooling Design

### 5.1 File Detection

DarTsx detection is content-based. The editor plugin treats a file as DarTsx only when it sees DarTsx-specific declarations such as `component`, `state`, or `derived` in statement positions.

This selective activation matters because the extension injects into both TypeScript and TSX editors, but regular TS files must not be reinterpreted as DarTsx.

### 5.2 Virtual Code

The TypeScript plugin uses a Volar `LanguagePlugin` to create a virtual TS or TSX view of DarTsx source.

Current lowering rules include:

| DarTsx | Service view |
|---|---|
| `component` | `function` |
| `state` | `let` |
| `derived` | `const` |
| `render (...)` | `return (<>...</>)` |
| `bind` parameters | plain parameters |
| renamed props | ordinary parameter identifiers |
| bind attributes | valid placeholder JSX attribute names |

This lowering exists to make TypeScript services usable. It is not the runtime compiler output.

### 5.3 Hover and Quick Info Rewriting

Lowered TS syntax is useful for type-checking but not ideal for DarTsx users, so the plugin rewrites selected quick info results back into DarTsx-native terms.

Current rewrite behavior includes:

- `function` hover labels rewritten to `component` when the symbol comes from a DarTsx component.
- `let` and `const` hover labels rewritten to `state` and `derived` where appropriate.
- parameter labels rewritten to `prop` or `binded prop` for component parameters.
- aliased imports resolved back to the definition site so imported `state` and `derived` symbols keep useful labels and type info.

### 5.4 Diagnostic Filtering

The plugin suppresses known false positives that are artifacts of DarTsx syntax or lowering strategy while leaving ordinary TypeScript errors visible.

Important examples:

- imported reactive state write sites should not show the default TS import-assignment diagnostic.
- lowered syntax artifacts from DarTsx-only constructs should not surface as user-facing noise when the underlying DarTsx code is valid.

This is intentionally a filter layer, not a second semantic checker.

### 5.5 Syntax Highlighting

The VS Code extension provides a TextMate injection grammar that targets both `source.ts` and `source.tsx`.

It currently highlights:

- `component`, `state`, `derived`, `render`
- `bind` in JSX and parameter positions
- renamed props and bindable renamed props
- nested `function` declarations inside DarTsx components
- DarTsx-flavored JSX contexts inside TypeScript files

The grammar is intentionally lightweight. Semantic correctness still comes from tsserver and the compiler.

## 6. Build-Time Tooling Design

### 6.1 Vite Plugin Role

The Vite plugin is responsible for real compile-time behavior in dev and build flows.

Its current responsibilities are:

- compile DarTsx `.tsx` modules
- compile DarTsx-flavored `.ts` modules when they contain DarTsx syntax
- inspect imported DarTsx modules to discover reactive exports
- propagate reactive call information across modules
- invalidate affected modules when reactive call-site information changes

### 6.2 Compiler vs Editor Transform

There are two related but distinct transforms in the repo:

- the editor transform in `packages/typescript-plugin` exists to make tsserver understand DarTsx source
- the compiler in `packages/dartsx` exists to generate runtime code

They intentionally solve different problems. The editor transform aims for type-service compatibility and source mapping. The compiler aims for correct emitted runtime behavior.

### 6.3 Cross-File Reactivity

Cross-file reactive behavior is a build concern, not just an editor concern.

The Vite plugin tracks:

- reactive exports produced by DarTsx modules
- which imported functions receive reactive arguments
- when that information changes enough to require recompiling downstream modules

This is what allows examples like shared state modules and helper functions in separate files to behave correctly in the playground and production build.

## 7. Current Capability Snapshot

### 7.1 Working Today

- DarTsx-aware hover labels for components, state, derived, props, and bindable props
- go-to-definition through the TS plugin path
- diagnostic suppression for known DarTsx false positives
- renamed props and bindable renamed props across editor tooling, compiler output, runtime tests, and playground examples
- syntax coloring for DarTsx keywords in TypeScript and TSX, including multiline bind parameter cases
- Vite compilation for DarTsx `.tsx` and DarTsx-flavored `.ts`
- cross-file reactive export/import handling in build flows

### 7.2 Deliberately Not Present

- no standalone language server process
- no second custom semantic engine beside TypeScript plus compiler checks
- no custom file extension requirement

## 8. Validation

The current tooling architecture is expected to stay green under:

- workspace build via `pnpm -r run build`
- test suite via `pnpm test` or `npx vitest run`
- playground production build through the workspace build

When the tooling architecture changes, these validation paths should be kept current before adding new editor-facing behavior.

## 9. Known Constraints

1. DarTsx still lives inside `.ts` and `.tsx`, so detection heuristics must remain conservative.
2. TextMate grammar rules are approximate and should not be treated as the source of truth for semantics.
3. Hover rewriting depends on definition lookup and transformed TS quick info; edge cases should be covered with tests when new syntax is added.
4. Editor lowering and runtime compilation are separate implementations, so new language features often require changes in both places.

## 10. Near-Term Maintenance Priorities

1. Keep the tooling docs aligned with the shipped architecture instead of speculative designs.
2. Add focused regression coverage whenever DarTsx syntax is introduced or rewritten in the TS plugin or compiler.
3. Continue removing dead compatibility code rather than preserving unused architectural branches.
