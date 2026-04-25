---
title: Comparison
---

# Comparison

How DarTsx compares to React and Svelte.

## Component definition

```tsx
// DarTsx
component Counter() {
  state count = 0;
  render <button onclick={() => count++}>{count}</button>
}
```

```tsx
// React
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

```svelte
<!-- Svelte 5 -->
<script>
  let count = $state(0);
</script>
<button onclick={() => count++}>{count}</button>
```

## State

| | DarTsx | React | Svelte 5 |
|:---|:---|:---|:---|
| Syntax | `state x = 0` | `const [x, setX] = useState(0)` | `let x = $state(0)` |
| Update | `x++` | `setX(x + 1)` | `x++` |
| Deep | Auto proxy | `useReducer` / immer | `$state` on objects |
| Derived | `derived y = x * 2` | `useMemo(() => x * 2, [x])` | `let y = $derived(x * 2)` |

## Reactivity model

| | DarTsx | React | Svelte 5 |
|:---|:---|:---|:---|
| Granularity | Per-signal (fine) | Per-component (coarse) | Per-signal (fine) |
| Tracking | Compile-time | Manual deps arrays | Compile-time |
| Updates | Direct DOM | Virtual DOM diff | Direct DOM |
| Batching | Microtask | `startTransition` / auto | Microtask |

## Effects

```tsx
// DarTsx — explicit deps, no dep array
import { effect } from 'dartsx';
effect(count, (val, prev) => console.log(val));

// React — dep array
useEffect(() => { console.log(count); }, [count]);

// Svelte 5
$effect(() => { console.log(count); });
```

## Control flow

```tsx
// DarTsx — native JS in JSX
{if (show) { <p>Yes</p> }}
{for (const item of items) { <li>{item}</li> }}

// React — ternaries and .map()
{show ? <p>Yes</p> : null}
{items.map(item => <li key={item.id}>{item}</li>)}
```

```svelte
<!-- Svelte -->
{#if show}<p>Yes</p>{/if}
{#each items as item}<li>{item}</li>{/each}
```

## Key differences

- **No virtual DOM** — DarTsx compiles to direct DOM operations, like Svelte
- **No dep arrays** — Dependencies are tracked by the compiler, not manually listed
- **No special syntax** — Keywords are native JavaScript extensions, not template directives or runes
- **Cross-module reactivity** — State flows across file boundaries automatically via the Vite plugin
- **Standard JSX** — Uses JSX for templates, not a custom template language
