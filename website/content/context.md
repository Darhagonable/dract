---
title: Context
---

# Context

Context lets you share data across a component tree without passing props through every level.

## Creating context

Use `createContext` with a factory function:

```tsx
import { createContext } from 'dartsx';

const ThemeContext = createContext(() => {
  state theme = 'light';

  function toggle() {
    theme = theme === 'light' ? 'dark' : 'light';
  }

  return { theme, toggle };
});
```

The factory runs once when `provide` is called. It can use `state` and `derived` for reactive context values.

## Providing context

Call `provide` in a parent component to make context available to its subtree:

```tsx
import { provide } from 'dartsx';

component App() {
  provide(ThemeContext);

  render (
    <Header />
    <Main />
  )
}
```

## Consuming context

Call the context function to read the value:

```tsx
component Header() {
  const { theme, toggle } = ThemeContext();

  render (
    <header class={theme}>
      <button onclick={toggle}>Toggle theme</button>
    </header>
  )
}
```

Calling a context outside a provider's tree throws an error.

## Factory arguments

The factory can accept arguments passed through `provide`:

```tsx
const UserContext = createContext((initialUser: User) => {
  state user = initialUser;
  return { user };
});

// Provide with arguments
provide(UserContext, { name: 'Alice', role: 'admin' });

// Consume
const { user } = UserContext();
```

## Reactive context

Because the factory can use `state` and `derived`, context values are reactive. Consumers automatically see updates:

```tsx
const CounterContext = createContext(() => {
  state count = 0;
  derived doubled = count * 2;

  return { count, doubled, increment: () => count++ };
});
```

Any component that reads `count` or `doubled` from the context will update when those values change.
