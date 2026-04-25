---
title: Introduction
---

# Introduction

DarTsx is a compiled UI framework for JavaScript. It extends JavaScript with a handful of keywords — `component`, `state`, `derived`, and `render` — that the compiler transforms into efficient, direct DOM operations.

There is no virtual DOM. No runtime diffing. No template language to learn. You write JavaScript, and the compiler does the rest.

## Key features

- **Native syntax** — `state`, `derived`, and `component` are keywords, not API calls
- **Compiled** — Components compile to direct DOM manipulation. No reconciliation overhead
- **Fine-grained reactivity** — Only the exact DOM nodes that depend on changed state are updated
- **Deep reactivity** — Objects, arrays, Maps, Sets, and Dates are automatically reactive via proxies
- **Cross-module state** — Reactive state flows naturally across file boundaries

## A quick taste

```tsx
export component Counter() {
  state count = 0;

  render (
    <button onclick={() => count++}>
      clicks: {count}
    </button>
  )
}
```

`state count = 0` creates a reactive variable. When `count` changes, the text node `{count}` updates automatically — nothing else in the DOM is touched.
