---
title: Rendering
---

# Rendering

## The render keyword

Components output DOM using the `render` keyword:

```tsx
component Hello() {
  render <h1>Hello!</h1>
}
```

Parentheses allow multiple root elements:

```tsx
component Multi() {
  render (
    <h1>Title</h1>
    <p>Paragraph</p>
  )
}
```

## Expressions

Use curly braces to embed JavaScript expressions:

```tsx
state name = "world";

render (
  <h1>Hello, {name}!</h1>
  <p>{2 + 2}</p>
  <p>{items.length > 0 ? 'has items' : 'empty'}</p>
)
```

## Dynamic attributes

Attributes can use expressions:

```tsx
state isActive = true;

render (
  <div class={isActive ? 'active' : ''}>
    <img src={user.avatar} alt={user.name} />
  </div>
)
```

### Shorthand attributes

When the attribute name matches the variable name:

```tsx
let id = "main";
render <div {id} /> // same as <div id={id} />
```

## Raw HTML

To inject raw HTML into your component, use the `{@html ...}` tag:

```tsx
<article>
  {@html content}
</article>
```

> Make sure that you either escape the passed string or only populate it with values that are under your control in order to prevent XSS attacks. Never render unsanitized content.

## Early render (guard clauses)

Multiple `render` statements work as guard clauses — the first one that executes wins:

```tsx
component AuthGate(loggedIn: boolean) {
  if (!loggedIn) {
    render <p>Please sign in.</p>
  }

  render (
    <h1>Dashboard</h1>
    <p>Private content</p>
  )
}
```

If `loggedIn` is `false`, the first `render` executes and the component stops there. If `true`, it falls through to the second `render`.
