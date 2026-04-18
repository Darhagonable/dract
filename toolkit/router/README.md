# @dartsx-toolkit/router

Client-side routing for DarTsx. Fully typesafe, code-based, built on the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) and [URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern).

## Route Definitions

A route maps a URL pattern to a handler that receives typed params and returns JSX:

```tsx
const routes = {
  "/": () => <Home/>,
  "/books/:id(\\d+)": ({ id }) => <BookPage id={id}/>,
  "/settings": () => <Settings/>,
}
```

### Flat vs Tree

Two interchangeable structures. Both produce the same hierarchy under the hood:

```tsx
// Flat Mode
const routes = {
  "/about": () => <About/>,
  "/about/work": () => <Work/>,
  "/about/work/mywork": () => <MyWork/>,
  "/about/contact": () => <Contact/>,
}

// Tree Mode
const routes = {
  "/about": {
    "/": () => <About/>,
    "/work": {
      "/": () => <Work/>,
      "/mywork": () => <MyWork/>,
    },
    "/contact": () => <Contact/>,
  },
}
```

## Usage

### `createRouter()`

The entry point. Define your routes once, get back typed components and hooks:

```tsx
import { createRouter } from '@dartsx-toolkit/router'
import { Home, BookPage, About } from './pages'

export const { Router, Link, RouterContext } = createRouter({
  "/": () => <Home/>,
  "/books/:id(\\d+)": ({ id }) => <BookPage id={id}/>,
  "/about": () => <About/>,
})
```

Export `Router`, `Link`, and `RouterContext` from a shared module so all components can import them with full type safety.

### `<Router>`

Renders the matched route's component. When no route matches, renders nothing.

```tsx
import { Router } from './router'

component App() {
  render <Router/>
}
```

### `<Link>`

Navigates without a full page reload. Renders a plain `<a>` tag — the Navigation API intercepts the click.

```tsx
import { Link } from './router'

// Absolute — `to` is typed to your route map
<Link to="/about">About</Link>

// With class
<Link to="/" class="nav-link">Home</Link>
```

**Props:**
- `to` — Destination path (typed union of defined routes)
- `children?` — Link content
- `class?` — CSS class

## Accessing Router State

`RouterContext()` reads reactive router state from any descendant component.

### Basic usage — untyped params

```tsx
import { RouterContext } from './router'

component Nav() {
  const router = RouterContext()

  render (
    <nav>
      <span>Current route: {router.route}</span>
      <span>Path: {router.pathname}</span>
      <button onclick={() => router.navigation.navigate("/")}>Home</button>
    </nav>
  )
}
```

### With path assertion — typed params

Pass a route pattern to `RouterContext()` to assert the current route and get typed params:

```tsx
component BookPage() {
  // Throws at runtime if the current route doesn't match "/books/:id"
  const router = RouterContext("/books/:id(\\d+)")

  router.params.id    // ✓ string — typed from the pattern
  router.params.nope  // ✗ type error

  render <h1>Book #{router.params.id}</h1>
}
```

This is useful for components that are only ever rendered on a specific route. The generic flows from the pattern string:

```tsx
RouterContext()                      // params: Record<string, string>
RouterContext("/books/:id")          // params: { id: string }
RouterContext("/users/:userId/posts/:postId") // params: { userId: string, postId: string }
```

**`RouterState` fields:**
- `route` — Matched pattern string, e.g. `"/books/:id"` (reactive)
- `pathname` — Current pathname (reactive)
- `params` — Matched route params (reactive, typed when path is provided)
- `search` — Query string including `?` (reactive)
- `hash` — Hash including `#` (reactive)
- `navigation` — Navigation API instance (reactive) type patched for type safety

## Navigation

### Programmatic

Use the `navigation` field (the browser's [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation/navigate)) for programmatic navigation:

```tsx
const router = RouterContext()

// Absolute
router.navigation.navigate("/books/42")

// Replace history entry instead of pushing
router.navigation.navigate("/login", { history: 'replace' })
```

### Type Safety

`createRouter()` binds all types at the definition site. Every consumer gets full autocomplete and type checking for free:

```tsx
const { Router, Link, RouterContext } = createRouter({
  "/": () => <Home/>,
  "/books/:id": ({ id }) => <BookPage id={id}/>,
  "/about": () => <About/>,
})

// navigation.navigate() accepts: "/" | "/books/:id" | "/about" | ".."
const router = RouterContext()
router.navigation.navigate("/books/42") // ✓
router.navigation.navigate("/nope")     // ✗ type error

// Link's `to` prop has the same union
<Link to="/about">About</Link>  // ✓
<Link to="/nope">Nope</Link>    // ✗ type error
```

Route params are also typed at the definition site:

```tsx
"/books/:id(\\d+)": ({ id }) => ...
//                     ^-- id: string, inferred from pattern
```

## Open Questions

- Should `<Link>` have an `active` class when the current route matches `to`?
- Should `navigate` return a promise or be fire-and-forget?
- Do we need route guards / `beforeNavigate` hooks?
- Should we support `<Outlet>` for nested layout rendering?
- Do we want search param helpers (typed query string parsing)?
