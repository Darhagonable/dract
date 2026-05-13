# Scoped CSS

## Overview

DarTsx scopes component styles by adding a unique data attribute to every element a component authors, and appending that attribute selector to every CSS rule. This is the same strategy as Svelte (which uses class hashes) and Vue (which uses `data-v-*` attributes) — but uses data attributes with `:where()` to keep specificity neutral.

No `@scope` is used — data attribute selector rewriting handles everything without requiring browser support for newer CSS features.

## How It Works

`<style>` blocks are **scoped by default** — no attribute needed. To write global (unscoped) styles, use `<style global>`.

Each scoped `<style>` block gets:

1. A `data-scope` attribute with a unique hash token (e.g., `data-scope="a1b2c3"`) added to elements at the same level and down
2. Its CSS selectors rewritten to include `[data-scope~="a1b2c3"]`
3. The CSS injected into the document or extracted to a `.css` file

A component can have multiple `<style>` blocks at different nesting levels — each scopes to its siblings and their descendants.

```tsx
component Card() {
  render (
    <div>
      <h2>Title</h2>
      <p>Content</p>
    </div>
    <style>
      h2 { color: red; }
      p { font-size: 14px; }
    </style>
  )
}
```

Compiles to:

```js
function Card() {
  $.style("a1b2c3",
    "h2[data-scope~=\"a1b2c3\"] { color: red; }\n" +
    "p[data-scope~=\"a1b2c3\"] { font-size: 14px; }"
  );

  return $.jsx("div", {
    "data-scope": "a1b2c3",
    children: [
      $.jsx("h2", { "data-scope": "a1b2c3", children: "Title" }),
      $.jsx("p", { "data-scope": "a1b2c3", children: "Content" }),
    ]
  });
}
```

The `<style>` block is **not rendered to the DOM** — the compiler extracts it and emits a `$.style()` call instead.

## Compiler Options

The `css` option in the Vite plugin controls how styles are delivered:

### `css: 'injected'`

Styles are included in the JS bundle. When the component mounts, `$.style(id, css)` creates a `<style data-dartsx="id">` element in `<head>` if one doesn't already exist. Reference-counted: multiple instances of the same component share one `<style>` element; when the last instance unmounts, the element is removed.

### `css: 'external'`

The CSS is returned in the `css` field of the compilation result and not included in the JS output. The Vite plugin collects these CSS fragments and emits them as cacheable `.css` files. This results in smaller JS bundles and better caching.

**Default:** `'external'` for both development and production. Use `'injected'` when you need styles bundled in JS (e.g., Web Components, single-file distribution).

## Compilation Strategy

### Scope Hash Generation

Each `<style>` block within a component gets its own unique hash. A component with multiple `<style>` blocks at different nesting levels generates multiple hashes:

```
hash("src/components/Card.tsx::Card::0") → "aaa111"   (outer style)
hash("src/components/Card.tsx::Card::1") → "bbb222"   (inner style)
```

- Deterministic: same input always produces the same hash
- Unique: different `<style>` blocks get different hashes, even within the same component
- Short: 7-character base-36 suffix
- Attribute: `data-scope="{hash}"`

### Data Attribute Injection

Each `<style>` block's scope attribute is added to its **sibling elements and all their descendants**. Elements deeper in the tree may accumulate multiple scope hashes (space-separated in a single `data-scope` attribute) if they fall within multiple `<style>` scopes.

When there's a single `<style>` at the root level (the common case), this means every element gets the attribute — same as Svelte/Vue:

**Single root:**
```tsx
render <div><p>text</p></div>
// → <div data-scope="a1b2c3"><p data-scope="a1b2c3">text</p></div>
```

**Multiple roots (fragment):**
```tsx
render (
  <h1>Title</h1>
  <p>Subtitle</p>
)
// → <h1 data-scope="a1b2c3">...</h1>
//   <p data-scope="a1b2c3">...</p>
```

### Selector Rewriting

Every CSS selector in the `<style>` block is rewritten to append the data attribute. The attribute is added to the **last element selector** in each compound selector (the subject):

| Authored | Compiled |
|---|---|
| `p { ... }` | `p[data-scope~="a1b2c3"] { ... }` |
| `.card { ... }` | `.card[data-scope~="a1b2c3"] { ... }` |
| `div > p { ... }` | `div > p[data-scope~="a1b2c3"] { ... }` |
| `ul li:first-child { ... }` | `ul li:first-child[data-scope~="a1b2c3"] { ... }` |
| `h1, h2 { ... }` | `h1[data-scope~="a1b2c3"], h2[data-scope~="a1b2c3"] { ... }` |
| `::before` | `[data-scope~="a1b2c3"]::before { ... }` (on the owning element) |

For subsequent selectors in a complex selector, `:where([data-scope~="a1b2c3"])` is used to avoid specificity inflation (like Svelte):

| Authored | Compiled |
|---|---|
| `.parent .child { ... }` | `.parent:where([data-scope~="a1b2c3"]) .child[data-scope~="a1b2c3"] { ... }` |

### CSS Extraction

The `<style>` tag is removed from the render output during the transform phase. Its text content is:

1. Parsed to rewrite selectors (append `[data-scope~="hash"]`)
2. `@keyframes` names are hash-prefixed
3. `:global()` rules are extracted and emitted without scoping
4. Emitted as a `$.style(hash, css)` call (injected mode) or returned as `css` output (external mode)

### Nested Style Blocks

A component can have multiple `<style>` blocks at different nesting levels. Each `<style>` scopes to its **siblings and their descendants** — the same level and down.

```tsx
component StyledComponent() {
  render (
    <div>
      <p>Outside should be styled</p>
      <div>
        <p>Inside should be styled</p>
        <style>
          p { color: green; }
        </style>
      </div>
    </div>
    <style>
      p { color: red; }
    </style>
  )
}
```

Each `<style>` block gets its own scope hash. Elements accumulate scope hashes (space-separated) in a single `data-scope` attribute:

```
div[data-scope="aaa"]                              ← outer scope only
├── p[data-scope="aaa"]                             ← "Outside" → red
└── div[data-scope="aaa bbb"]                       ← both scopes
    └── p[data-scope="aaa bbb"]                     ← "Inside" → green
```

The compiled CSS emits outer styles first, inner styles second:

```css
/* outer style block */
p[data-scope~="aaa"] { color: red; }

/* inner style block */
p[data-scope~="bbb"] { color: green; }
```

The inner `<p>` matches both rules (it has both scope hashes), but `green` wins because it appears later in source order with equal specificity. The outer `<p>` only has the `aaa` hash, so only `red` applies.

**Scoping rules for each `<style>` block:**

1. The `<style>` tag is removed from the render output
2. A new scope hash is generated for this `<style>` block
3. The data attribute for this scope is added to all **sibling elements** of the `<style>` tag and all their **descendants**
4. The CSS selectors are rewritten with this scope's hash
5. CSS is emitted in document order: outer `<style>` blocks first, inner ones later

**Another example — styling only a subsection:**

```tsx
component Page() {
  render (
    <main>
      <article>
        <h1>Title</h1>
        <p>Article text</p>
        <style>
          h1 { font-size: 2em; }
          p { line-height: 1.6; }
        </style>
      </article>
      <aside>
        <h1>Sidebar</h1>
        <p>Sidebar text</p>
        <style>
          h1 { font-size: 1.2em; }
          p { font-size: 0.9em; }
        </style>
      </aside>
    </main>
  )
}
```

The `<article>` and `<aside>` each get their own scope — their styles don't interfere with each other, even though both target `h1` and `p`.

## Scoping & Slotted Content

The core challenge: **children/slots are authored in the parent but rendered inside the child's DOM tree.**

### The Problem

```tsx
component StyledParent() {
  render (
    <div>
      <p>Styled by parent</p>
      <Child>
        <p>Also styled by parent — authored here</p>
      </Child>
    </div>
    <style>
      p { color: red; }
    </style>
  )
}

component Child(children) {
  render (
    <div>
      <p>NOT styled by parent</p>
      {children}
    </div>
  )
}
```

### The Solution

Every element gets the data attribute of **the component that authored it**:

```
div[data-scope~="parent"]
├── p[data-scope~="parent"]            → "Styled by parent"         ✅ red
└── div[data-scope~="child"]
    ├── p[data-scope~="child"]         → "NOT styled by parent"      ❌ not red
    └── p[data-scope~="parent"]        → "Also styled by parent"     ✅ red
```

The compiled CSS `p[data-scope~="parent"]` matches only the `<p>` elements with the parent's attribute — including slotted content — while correctly excluding the child's own `<p>`.

### Attribute Placement Rules

| Element | Gets data attribute |
|---|---|
| Root element(s) | ✅ Yes |
| Nested HTML elements in template | ✅ Yes |
| Elements passed as `children` to other components | ✅ Yes (authored by the passing component) |
| Elements passed as props (render props) | ✅ Yes (authored by the passing component) |
| Elements rendered by child components | ❌ No (they get the child's attribute) |
| Third-party components' internal elements | ❌ No (no access) |

## Edge Cases

### Multiple Root Elements (Fragments)

Each root element gets the data attribute:

```tsx
render (
  <h1>Title</h1>
  <p>Content</p>
  <style>
    h1 { font-size: 2em; }
  </style>
)
```

```css
h1[data-scope~="abc123"] { font-size: 2em; }
```

### Multiple Components Per File

Each component gets an independent hash based on `filepath::ComponentName`:

```tsx
// Card.tsx
component CardHeader() {
  render <header>...</header>
  <style>header { border-bottom: 1px solid; }</style>
}

component CardBody() {
  render <div>...</div>
  <style>div { padding: 16px; }</style>
}
```

`CardHeader` → `data-scope="aaa111"`, `CardBody` → `data-scope="bbb222"`. Completely independent scopes.

### Component With No Root Element

If a component returns a primitive, null, or a text node, there is no element to attach the data attribute to. The compiler **warns** that scoped styles won't be applied.

### Dynamic Components / Conditional Rendering

Elements inside control flow (`{if}`, `{for}`, `{switch}`) are still authored by the component and get its data attribute:

```tsx
component List() {
  state items = ['a', 'b', 'c'];
  render (
    <ul>
      {for (const item of items) <li>{item}</li>}
    </ul>
    <style>li { padding: 4px; }</style>
  )
}
```

All `<li>` elements get `data-scope="hash"`.

### Children / Slots

Elements passed via `children` retain the **parent's** data attribute:

```tsx
component Parent() {
  render (
    <Wrapper>
      <p>I am styled by Parent</p>
    </Wrapper>
    <style>p { color: blue; }</style>
  )
}
```

The `<p>` has `data-scope="parent"` and the CSS `p[data-scope~="parent"]` targets it.

### Component-as-Prop / Render Props

Same rule — JSX authored at the call site gets the call site's data attribute:

```tsx
component Dashboard() {
  render (
    <DataTable
      header={<th>Name</th>}
      renderRow={(row) => <tr><td>{row.name}</td></tr>}
    />
    <style>
      th { background: #333; color: white; }
      td { padding: 8px; }
    </style>
  )
}
```

`<th>` and `<td>` get `data-scope="dashboard"`.

### `<style global>` — Unscoped Styles

By default, `<style>` is scoped. To write global styles that aren't rewritten, use the `global` attribute:

```tsx
component App() {
  render (
    <div><Router /></div>
    <style global>
      body { margin: 0; }
      * { box-sizing: border-box; }
    </style>
  )
}
```

The CSS is emitted as-is — no data attribute appended, no selector rewriting. Useful for resets, global typography, and third-party overrides.

A component can have both scoped and global style blocks:

```tsx
render (
  <div>...</div>
  <style>
    div { padding: 16px; }  /* scoped */
  </style>
  <style global>
    body { margin: 0; }     /* global */
  </style>
)
```

### `:global()` — Global Selectors Within Scoped Blocks

To opt out of scoping for specific rules within a scoped `<style>`, use `:global()`:

```tsx
<style>
  p { color: red; }               /* scoped */
  :global(body) { margin: 0; }    /* unscoped */
  :global(.modal-backdrop) { ... } /* unscoped */
</style>
```

The compiler strips the `:global()` wrapper and emits the inner selector without appending the data attribute:

```css
/* Scoped */
p[data-scope~="abc123"] { color: red; }

/* Global */
body { margin: 0; }
.modal-backdrop { ... }
```

### `:deep()` — Styling Child Component Internals

Scoped selectors only match elements with the component's data attribute. To reach into a child component's DOM, use `:deep()`:

```tsx
component Parent() {
  render (
    <div>
      <Child />
    </div>
    <style>
      div { padding: 16px; }          /* scoped to Parent */
      .wrapper :deep(.child-title) {   /* pierces into Child */
        color: red;
      }
    </style>
  )
}
```

The compiler moves the data attribute to the selector **before** `:deep()` and leaves the inner selector unscoped:

| Authored | Compiled |
|---|---|
| `.wrapper :deep(.child-title)` | `.wrapper[data-scope~="abc123"] .child-title` |
| `:deep(.child-title)` | `[data-scope~="abc123"] .child-title` |
| `.card :deep(p > span)` | `.card[data-scope~="abc123"] p > span` |

This is the same semantics as Vue's `:deep()`. The scoping boundary stops at the `:deep()` call — everything inside it matches globally within that subtree.

**Use sparingly** — `:deep()` creates coupling between parent and child component internals.

### `@keyframes` and Animations

`@keyframes` names are global in CSS. Two components with `@keyframes fadeIn` would collide. The compiler hash-prefixes keyframe names (same approach as Svelte):

```tsx
<style>
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  div { animation: fadeIn 0.3s; }
</style>
```

Compiles to:

```css
@keyframes a1b2c3-fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
div[data-scope~="a1b2c3"] { animation: a1b2c3-fadeIn 0.3s; }
```

The compiler rewrites both the `@keyframes` name and any `animation` / `animation-name` references.

To define a global keyframe (shared across components), put it in a `<style global>` block where no hash-prefixing occurs.

### `@media` and `@container` Queries

These wrap the scoped selectors normally:

```css
@media (max-width: 768px) {
  p[data-scope~="abc123"] { font-size: 12px; }
}

@container (min-width: 400px) {
  div[data-scope~="abc123"] { display: grid; }
}
```

### CSS Custom Properties

CSS custom properties (`--*`) inherit through the DOM tree. A parent can set variables that children consume:

```tsx
component Theme() {
  render (
    <div><Card /></div>
    <style>
      div { --brand-color: coral; }
    </style>
  )
}

component Card() {
  render (
    <div><p>Hello</p></div>
    <style>
      p { color: var(--brand-color); }
    </style>
  )
}
```

### Pseudo-Elements

Pseudo-elements are attached to the element they belong to:

```css
p[data-scope~="abc123"]::before { content: '→ '; }
```

### Third-Party Component Styling

Third-party components don't have DarTsx data attributes on their internal elements, so scoped selectors won't match. Use `:deep()` from a scoped parent, or `:global()`:

```tsx
<style>
  .wrapper :deep(.third-party-modal) { z-index: 1000; }  /* scoped entry point */
  :global(.third-party-modal) { z-index: 1000; }          /* fully global */
</style>
```

### SSR — Style Injection

In `'injected'` mode during SSR, `$.style()` collects CSS into a buffer. The collected CSS is serialized into `<style>` tags in `<head>`:

```html
<head>
  <style data-dartsx="a1b2c3">
    h2[data-scope~="a1b2c3"] { color: red; }
  </style>
</head>
```

On hydration, the client detects existing `<style data-dartsx="a1b2c3">` and skips re-injection.

In `'external'` mode, the `.css` file is linked via `<link>` — no runtime injection at all.

### HMR — Hot Module Replacement

In `'injected'` mode during development:

1. On hot update, finds the existing `<style data-dartsx="hash">` element
2. Replaces its `textContent` with updated CSS
3. No full page reload needed for style changes

### Specificity

Appending `[data-scope~="abc123"]` adds `(0, 1, 0)` specificity (one attribute selector). This is the same tradeoff Vue makes with `[data-v-*]`. Svelte adds `(0, 1, 0)` via a class instead.

| Authored | Compiled | Specificity |
|---|---|---|
| `p { ... }` | `p[data-scope~="abc123"] { ... }` | `(0, 1, 1)` |
| `.card { ... }` | `.card[data-scope~="abc123"] { ... }` | `(0, 2, 0)` |
| `#main { ... }` | `#main[data-scope~="abc123"] { ... }` | `(1, 1, 0)` |

This means scoped styles are slightly more specific than equivalent global styles. In practice this is desirable — component styles should win over generic global rules.

### Reactive Values in CSS — `{expression}`

To use component state or props in CSS values, wrap any JS expression in `{}`:

```tsx
component Button(color: string) {
  state size = 16;
  render (
    <button>Click me</button>
    <style>
      button {
        color: {color};
        font-size: {size}px;
        padding: {size / 2}px {size}px;
      }
    </style>
  )
}
```

The compiler transforms each `{expression}` into a CSS custom property with a human-readable name, and injects the values as a reactive `style` attribute on the root element:

```css
button[data-scope~="abc123"] {
  color: var(--color);
  font-size: var(--size);
  padding: var(--size-n83f) var(--size);
}
```

```js
function Button($$props) {
  const color = $.prop($$props, 'color');
  let size = $.state(16);

  return $.jsx("button", {
    "data-scope": "abc123",
    style: () => ({
      "--color": $.get(color),
      "--size": $.get(size) + "px",
      "--size-n83f": $.get(size) / 2 + "px",
    }),
    children: ["Click me"]
  });
}
```

The reactive `style` attribute sets CSS custom properties via `style.setProperty()` inside an effect, so values update automatically. The custom properties are set on the component's root element(s) and inherit down via the CSS cascade.

**Naming rules for CSS custom properties:**
- Simple identifier: `{color}` → `--color`, `{accentColor}` → `--accent-color` (camelCase → kebab-case)
- Complex expression: `{size / 2}` → `--size-<hash>` (identifiers + short hash for uniqueness)
- Duplicate expressions reuse the same custom property name

**Rules:**
- `{expression}` can appear anywhere a CSS value is expected
- Each unique expression gets its own readable CSS custom property
- The suffix after `}` (like `px`) is included in the runtime value, not the CSS variable
- If the expression is reactive (state, prop, derived), the custom property updates automatically
- Static expressions are still compiled the same way for consistency

### Dead Code Elimination

The compiler can detect unused scoped styles at build time (optional):

1. Collect all selectors in the `<style>` block
2. Check if the component's template contains matching elements
3. Warn on selectors that can never match

This is a lint/warning feature — dynamic content may produce elements that static analysis can't see.
