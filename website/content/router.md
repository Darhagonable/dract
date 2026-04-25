---
title: Router
---

# Router

The `@dartsx-toolkit/router` package provides type-safe client-side routing built on the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) and [URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern).

## Setup

Define your routes once and export the typed components:

```tsx
import { createRouter } from '@dartsx-toolkit/router';
import Home from './Home';
import About from './About';
import UserProfile from './UserProfile';

export const { Router, Link, RouterContext } = createRouter({
  '/': () => <Home/>,
  '/about': () => <About/>,
  '/users/:id': ({ id }) => <UserProfile id={id}/>,
});
```

Each route handler receives typed params and returns JSX.

`createRouter` returns three items:

- **`<Router/>`** — renders the matched route's component
- **`<Link/>`** — a typed `<a>` tag for navigation
- **`RouterContext`** — access current route info

## &lt;Router/&gt;

Place `<Router/>` where route content should appear:

```tsx
component App() {
  render (
    <Header/>
    <Router/>
  )
}
```

When no route matches, nothing is rendered.

## &lt;Link/&gt;

Type-safe navigation links. Renders a plain `<a>` tag — the Navigation API intercepts the click:

```tsx
<Link to="/">Home</Link>
<Link to="/about">About</Link>
<Link to="/users/42">User 42</Link>
```

The `to` prop is a typed union of all defined routes (with params filled in) — invalid paths are caught at compile time.

**Props:**
- `to` — Destination path (typed)
- `children` — Link content
- `class` — CSS class

## Route parameters

Dynamic segments use `:param` syntax. Parameters are passed to the route handler:

```tsx
createRouter({
  '/users/:id': ({ id }) => <UserProfile id={id}/>,
  '/posts/:slug': ({ slug }) => <Post slug={slug}/>,
});
```

## Flat vs nested routes

Two interchangeable structures. Both produce the same hierarchy:

```tsx
// Flat
createRouter({
  '/about': () => <About/>,
  '/about/work': () => <Work/>,
  '/about/contact': () => <Contact/>,
});

// Nested
createRouter({
  '/about': {
    '/': () => <About/>,
    '/work': () => <Work/>,
    '/contact': () => <Contact/>,
  },
});
```

## `RouterContext`

Access reactive route state inside any component:

```tsx
component Breadcrumb() {
  const router = RouterContext();

  render <nav>{router.pathname}</nav>
}
```

### Typed params with path assertion

Pass a route pattern to assert the current route and get typed params:

```tsx
component UserProfile() {
  const router = RouterContext('/users/:id');
  // router.params.id is typed as string
  // Throws at runtime if the current route doesn't match

  render <h1>User #{router.params.id}</h1>
}
```

### `RouterState` fields

- `route` — Matched pattern string, e.g. `"/users/:id"` (reactive)
- `pathname` — Current pathname (reactive)
- `params` — Matched route params (reactive, typed when path is provided)
- `search` — Query string including `?` (reactive)
- `hash` — Hash including `#` (reactive)
- `navigation` — Navigation API instance, type-patched for safety

## Programmatic navigation

Use the `navigation` field from `RouterContext`:

```tsx
const router = RouterContext();

// Navigate
router.navigation.navigate('/users/42');

// Replace history entry
router.navigation.navigate('/login', { history: 'replace' });
```

`navigation.navigate()` is typed — only valid routes are accepted.

## Type safety

`createRouter()` binds all types at the definition site. Every consumer gets full autocomplete and type checking:

```tsx
const { Router, Link, RouterContext } = createRouter({
  '/': () => <Home/>,
  '/books/:id': ({ id }) => <BookPage id={id}/>,
  '/about': () => <About/>,
});

// Link's `to` prop is a typed union
<Link to="/about">About</Link>   // ✓
<Link to="/nope">Nope</Link>     // ✗ type error

// navigation.navigate() has the same union
const router = RouterContext();
router.navigation.navigate('/books/42'); // ✓
router.navigation.navigate('/nope');     // ✗ type error
```
