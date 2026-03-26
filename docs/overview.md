# Overview

DarTsx is a reactive UI framework that uses a simple, declarative syntax to build interactive user interfaces.

## Key Features

- **Simple syntax** - `state`, `derived`, `component`, and `render` keywords
- **Fine-grained reactivity** - Updates only what changes
- **No Virtual DOM** - Direct DOM manipulation for maximum performance
- **TypeScript support** - Full type safety and IDE autocomplete
- **Multiple root elements** - No wrapper divs needed
- **Built-in reactive types** - Map, Set, and Date are reactive when used with `state`

## Documentation

- [Compiler](./compiler.md) - How the compiler transforms your code
- [Components](./components.md) - Component definition, props, children, composition
- [Reactivity](./reactivity.md) - State, derived state, effects, and state transport
- [Event Handlers](./event-handlers.md) - Handling user events
- [Control Flow](./control-flow.md) - Conditionals, loops, switch statements
- [Bindings](./bindings.md) - Two-way data binding
- [Lifecycle Hooks](./lifecycle-hooks.md) - Component lifecycle methods
- [Comparison](./comparison.md) - Comparison with React and Svelte

## Quick Example

```tsx
component Counter() {
  state count = 0
  derived doubled = count * 2

  render (
    <button onclick={count++}>
      clicks: {count}
    </button>
    <p>doubled: {doubled}</p>
  )
}
```

## Architecture

DarTsx uses a compiler-based approach:

1. **Compilation** - The `.tsx` files are compiled to optimized JavaScript
2. **Reactivity** - Fine-grained signals track dependencies between state and UI
3. **Template system** - Efficient DOM updates without Virtual DOM diffing
4. **Event delegation** - Events are delegated for optimal performance

See the [Compiler documentation](./compiler.md) for details on how code is transformed.
