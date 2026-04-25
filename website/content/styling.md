---
title: Styling
---

# Styling

## Class attribute

Use strings, objects, or arrays for dynamic classes:

```tsx
// String
<div class={isActive ? 'active' : ''} />

// Object — keys with truthy values are included
<div class={{ active: isActive, disabled: !isEnabled }} />

// Array — falsy values are filtered out
<div class={['card', isLarge && 'card-lg', isPrimary && 'primary']} />
```

## Style attribute

Inline styles accept a string or an object:

```tsx
// String
<div style="color: red; font-size: 16px" />

// Object — camelCase or kebab-case keys
<div style={{ color: 'red', fontSize: '16px' }} />

// Reactive
state color = 'blue';
<div style={{ color }} />
```

## Scoped CSS with style blocks

Add a `<style>` block as a sibling of your component's root element. Styles are automatically scoped to the component:

```tsx
component Alert(message: string) {
  render (
    <div class="alert">{message}</div>

    <style>
      .alert {
        padding: 1rem;
        background: #fef3cd;
        border: 1px solid #ffc107;
        border-radius: 4px;
      }
    </style>
  )
}
```

The compiler hashes a unique scope identifier per component and rewrites selectors to include it. This means `.alert` only matches elements inside that specific component — no global leaks.

### Global styles

Use `<style global>` when you need styles to apply across the whole page:

```tsx
component Layout() {
  render (
    <div class="layout">{children}</div>

    <style global>
      body { margin: 0; font-family: system-ui; }
    </style>
  )
}
```

### Nested selectors

Descendant selectors work as expected within scoped styles:

```tsx
<style>
  .card h2 { font-size: 1.2rem; }
  .card p { color: gray; }
</style>
```

Each selector is scoped — `.card h2` only matches `<h2>` elements inside a `.card` belonging to this component.

### Multiple style blocks

A component can have multiple `<style>` blocks at different nesting levels. Each block scopes to its siblings and their descendants:

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

Each `<style>` block gets its own scope hash, so the `<article>` and `<aside>` styles don't interfere with each other — even though both target `h1` and `p`.

You can also mix scoped and global blocks in the same component:

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

## Reactive values in CSS

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

- Simple identifiers like `{color}` become `--color`
- camelCase like `{accentColor}` becomes `--accent-color`
- Complex expressions like `{size / 2}` become `--size-<hash>` for uniqueness
- Suffixes after `}` (like `px`) are included in the runtime value, not the CSS variable
- Reactive expressions (state, props, derived) update the custom property automatically

## `:deep()` selector

Scoped styles don't reach into child components by default. Use `:deep()` to target elements inside child components:

```tsx
<style>
  .wrapper :deep(h2) {
    color: navy;
  }

  :deep(.child-class) {
    border: 1px solid gray;
  }
</style>
```

The `:deep()` pseudo-class removes the scope attribute from the inner selector, allowing it to match elements rendered by child components while still requiring the outer selector to be scoped.

## Unused selector detection

The compiler detects selectors in `<style>` blocks that don't match any elements in your component's template and emits a warning during compilation:

```tsx
component Card() {
  render (
    <div class="card">Hello</div>

    <style>
      .card { color: black; }
      .title { font-weight: bold; } /* ⚠ Warning: unused selector ".title" */
    </style>
  )
}
```

This helps catch typos, stale selectors after refactoring, and dead CSS. The warning is shown at build time and does not affect the output — unused selectors are still emitted to avoid breaking dynamic class usage. To suppress the warning for a selector you know is applied dynamically, add a `/* stylelint-ignore */` comment above it.
