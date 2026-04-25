---
title: Deep Reactivity
---

# Deep Reactivity

When `state` receives an object or array, it creates a deeply reactive proxy. This page explains how it works.

## Primitives vs objects

| Declaration | Runtime | Reactive via |
|:---|:---|:---|
| `state count = 0` | Signal | `$.get()` / `$.set()` |
| `state obj = { x: 1 }` | Proxy | Property access/assignment |
| `state arr = [1, 2]` | Proxy | Index access, `.push()`, etc. |
| `state m = new Map()` | Proxy | `.get()`, `.set()`, `.delete()` |
| `state s = new Set()` | Proxy | `.add()`, `.delete()`, `.has()` |
| `state d = new Date()` | Proxy | `.setTime()`, etc. |

## Per-property signals

Object proxies create a lazy signal for each property. Only properties that are actually read get tracked:

```tsx
state user = { name: 'Alice', age: 30 };

// Reading user.name creates a signal for 'name'
// Only UI that reads user.name updates when it changes
user.name = 'Bob'; // updates only name-dependent nodes
```

## Nested objects

Assigning an object as a property automatically wraps it in a proxy:

```tsx
state data = { user: { name: 'Alice' } };
data.user.name = 'Bob'; // triggers updates at all levels
```

Mutations bubble upward — an `effect(data, cb)` fires on any nested change.

## Arrays

Array methods work naturally:

```tsx
state items = ['a', 'b'];

items.push('c');      // triggers update
items[0] = 'z';       // triggers update
items.splice(1, 1);   // triggers update
```

## Maps

```tsx
state scores = new Map([['alice', 10]]);

scores.set('bob', 20);     // per-key signal + root signal
scores.delete('alice');     // per-key signal + version signal
scores.size;                // tracks version signal
```

## Sets

```tsx
state tags = new Set(['react']);

tags.add('dartsx');     // bumps version signal
tags.has('react');      // tracks version signal
tags.size;              // tracks version signal
```

## Dates

```tsx
state now = new Date();
now.setTime(Date.now());      // bumps single signal
now.toLocaleTimeString();     // tracks single signal
```

## Unwrapping

Access the original unproxied object with the `RAW` symbol:

```tsx
import { RAW } from 'dartsx/internal';
const raw = proxyObj[RAW]; // plain object
```

## Cross-module state

Export state from any module. The compiler and Vite plugin track reactive exports automatically:

```tsx
// store.ts
export state count = 0;
export function increment() { count++; }

// App.tsx
import { count, increment } from './store';
// count is reactive here — reads/writes are compiled to $.get/$.set
```

The Vite plugin maintains a registry of reactive exports. When a module imports them, the compiler wraps reads and writes in signal accessors.
