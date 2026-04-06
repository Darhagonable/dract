# Context

Context lets you share state across components without passing props through every level. A context is created with a factory function that returns the shared value. The context is scoped to the provider's subtree — only descendants of the component that calls `provide` can access it.

## Creating a Context

```tsx
import { createContext } from "dartsx"

const ThemeContext = createContext(() => {
  state theme = 'light'
  return theme
})
```

The factory function runs once when the context is first provided. It can use `state`, `derived`, and any other reactive primitives — the returned value is what consumers receive.

When the factory takes no arguments, the type is `Context<T>` where `T` is the return type:

```tsx
const ThemeContext = createContext(() => 'light')
// type: Context<string>
```

When the factory takes arguments, the type is `Context<F>` where `F` is the full factory signature:

```tsx
const GreetContext = createContext((name: string, style: "formal" | "casual") => ({
  name, style
}))
// type: Context<(name: string, style: "formal" | "casual") => { name: string; style: string }>
```

## Providing a Context

Call `provide` in a parent component to make the context available to all descendants:

```tsx
import { provide } from "dartsx"

component App() {
  provide(ThemeContext)

  render (
    <div>
      <ChildComponent />
    </div>
  )
}
```

## Consuming a Context

Call the context as a function to get the current value:

```tsx
component ChildComponent() {
  const theme = ThemeContext()

  render (
    <p>Current theme: {theme}</p>
  )
}
```

You can provide and consume in the same component:

```tsx
component App() {
  provide(ThemeContext)
  const theme = ThemeContext()

  render <p>{theme}</p>
}
```

You can also consume context inside a child block of the provider:

```tsx
component App() {
  render (
    <div>
      <ThemeProvider>
        {
          const theme = ThemeContext()
          render <p>{theme}</p>
        }
      </ThemeProvider>
    </div>
  )
}
```

## Factory Arguments

The factory can accept arguments passed via `provide`:

```tsx
const GreetContext = createContext((name: string) => {
  return `Hello, ${name}!`
})

component App() {
  provide(GreetContext, 'Alice')
  render <Child />
}

component Child() {
  const greeting = GreetContext()
  render <p>{greeting}</p> // "Hello, Alice!"
}
```

Multiple arguments work too:

```tsx
const ConfigContext = createContext((theme: string, lang: string) => ({ theme, lang }))

component App() {
  provide(ConfigContext, 'dark', 'en')
  render <Child />
}
```

When the factory takes no arguments, `provide` requires only the context:

```tsx
provide(ThemeContext)                // no-arg factory
provide(GreetContext, 'Alice')      // one arg
provide(ConfigContext, 'dark', 'en') // multiple args
```

## Scoping

Context is scoped to the provider's component subtree. Accessing a context outside of a provider's tree throws an error:

```tsx
component App() {
  render (
    <div>
      <Provider />
      <Outside /> // ❌ Error: context not provided
    </div>
  )
}

component Provider() {
  provide(ThemeContext)
  render <Consumer />
}

component Consumer() {
  const theme = ThemeContext() // ✓ Works — inside Provider's subtree
  render <p>{theme}</p>
}

component Outside() {
  const theme = ThemeContext() // ❌ Throws — not inside Provider's subtree
  render <p>{theme}</p>
}
```

## Reactive Context

Since the factory can use `state` and `derived`, context values are reactive:

```tsx
const CounterContext = createContext(() => {
  state count = 0
  const increment = () => count++
  return { count, increment }
})

component Parent() {
  provide(CounterContext)
  render <Child />
}

component Child() {
  const { count, increment } = CounterContext()

  render (
    <button onclick={increment}>Count: {count}</button>
  )
}
```
