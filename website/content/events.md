---
title: Event Handlers
---

# Event Handlers

DarTsx supports three ways to handle DOM events.

## Inline expressions

The simplest form — write the expression directly:

```tsx
<button onclick={count++}>Add 1</button>
<button onclick={isOpen = !isOpen}>Toggle</button>
```

## Arrow functions

For multi-step logic or when you need the event object:

```tsx
<button onclick={() => count++}>Add 1</button>
<button onclick={(e) => {
  e.preventDefault();
  submitForm();
}}>Submit</button>
```

## Method references

Pass a function reference:

```tsx
function handleClick() {
  count++;
}

<button onclick={handleClick}>Add 1</button>
```

## How detection works

The compiler distinguishes handlers by checking the expression:

- **Identifiers and property access** (`foo`, `foo.bar`) → treated as method references
- **Everything else** (`foo()`, `count++`, arrow functions) → treated as inline handlers, wrapped in a function automatically

## All DOM events

Any `on*` attribute works — `onclick`, `onmouseover`, `onkeydown`, `oninput`, etc. The attribute name maps directly to the DOM event.

```tsx
<input
  oninput={(e) => query = e.target.value}
  onkeydown={(e) => {
    if (e.key === 'Enter') search();
  }}
/>
```
