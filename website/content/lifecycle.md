---
title: Lifecycle Hooks
---

# Lifecycle Hooks

## onMount

Runs after the component is mounted to the DOM:

```tsx
import { onMount } from 'dartsx';

component Chart() {
  let canvas: HTMLCanvasElement;

  onMount(() => {
    const ctx = canvas.getContext('2d');
    drawChart(ctx);
  });

  render <canvas bind:this={canvas} />
}
```

## onDestroy

Runs immediately before the component is removed:

```tsx
import { onDestroy } from 'dartsx';

component Logger() {
  onDestroy(() => {
    console.log('component removed');
  });

  render <p>I exist</p>
}
```

## onCleanup

Registers cleanup that runs when the component unmounts. Inside an effect, it runs before each re-execution and on unmount:

```tsx
import { onMount, onCleanup } from 'dartsx';

component Timer() {
  state seconds = 0;

  onMount(() => {
    const id = setInterval(() => seconds++, 1000);
    onCleanup(() => clearInterval(id));
  });

  render <p>{seconds}s</p>
}
```

Inside an effect:

```tsx
import { effect, onCleanup } from 'dartsx';

effect(query, (q) => {
  const ctrl = new AbortController();
  fetch(`/api?q=${q}`, { signal: ctrl.signal });
  onCleanup(() => ctrl.abort());
});
```

## tick

Returns a promise that resolves after pending state changes are flushed. Useful when you need to read the DOM after a state update:

```tsx
import { tick } from 'dartsx';

state count = 0;
count++;
await tick();
// DOM is now updated
```

## Calling from external modules

Lifecycle hooks don't need to be called inside the component body — they work from any function called during component initialization:

```tsx
// useInterval.ts
import { onMount, onCleanup } from 'dartsx';

export function useInterval(callback: () => void, ms: number) {
  onMount(() => {
    const id = setInterval(callback, ms);
    onCleanup(() => clearInterval(id));
  });
}

// Timer.tsx
component Timer() {
  state count = 0;
  useInterval(() => count++, 1000);
  render <p>{count}</p>
}
```
