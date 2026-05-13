# JSX Block Expressions Spec

Inside JSX, `{}` can contain **any JavaScript** — not just single expressions. Control flow and rendering follow the same semantics as arrow functions:

- **Expression body** — a bare expression (JSX, value, ternary) is rendered directly, no `render` needed
- **Block body `{}`** — requires explicit `render`, just like `return` in a block arrow function

## Design Principles

1. **OXC does the heavy lifting** — we preprocess minimal custom syntax (`render`, `state`, `derived`, `component`) and let OXC parse everything else.
2. **Arrow function semantics** — expression body = implicit render, block body = explicit `render`.
3. **No special-casing** — `.map()`, `.filter()`, `.reduce()` etc. are just expressions. No compiler magic for specific method names.

---

## Valid: Simple Expressions (no `render` needed)

These are "eager" — single expressions that render automatically.

```tsx
// Text interpolation
<p>{name}</p>

// Computed expression
<p>{firstName + ' ' + lastName}</p>

// Ternary
<div>{isLoggedIn ? <Dashboard /> : <Login />}</div>

// Ternary with null
<div>{show ? <Modal /> : null}</div>

// Logical &&
<div>{isAdmin && <AdminPanel />}</div>

// Function call returning JSX (any function, not just .map)
<ul>{items.map(item => <li>{item}</li>)}</ul>
<ul>{renderItems(items)}</ul>
<div>{getContent()}</div>

// Function call returning an array of JSX
<ul>{buildListItems(data)}</ul>

// IIFE
<div>{(() => { const x = compute(); render <p>{x}</p> })()}</div>
```


## Valid:

```tsx
// Multiple render calls in one block path but since render is just a rename of return only the first one gets rendered
{
  render <p>First</p>
  render <p>Second</p>
}

// render without JSX because just like react a component can just return primitives as well
{
  render "just a string"
}

// Bare statements without render (its valid but wont do much but in theory you could update a signal in render if one wanted to)
{
  const x = 5
  const y = 10
  // nothing to render
}
```




## Valid: Control Flow Blocks

Control flow in JSX follows the same expression/block rules.

### If blocks

```tsx
// Direct JSX — one-liner
{if (show) <p>Visible</p>}

// Parenthesized expression — multi-line
{if (show) (
  <div>
    <p>Visible</p>
    <p>Details here</p>
  </div>
) else (
  <p>Hidden</p>
)}

// Block body — explicit render required
{if (user.isAdmin) {
  const greeting = `Welcome back, ${user.name}`
  render <h1>{greeting}</h1>
} else {
  render <p>Access denied</p>
}}

// Else-if chain — parenthesized expression
{if (status === 'loading') (
  <Spinner />
) else if (status === 'error') (
  <p class="error">{error.message}</p>
) else (
  <Dashboard data={data} />
)}

// Else-if chain — block body
{if (status === 'loading') {
  render <Spinner />
} else if (status === 'error') {
  const msg = formatError(error)
  render <p class="error">{msg}</p>
} else {
  render <Dashboard data={data} />
}}
```

### For loops

```tsx
// Direct JSX — one-liner
{for (const item of items) <li>{item.text}</li>}

// Parenthesized expression — multi-line
{for (const item of items) (
  <li>
    <span>{item.name}</span>
    <span>{item.price}</span>
  </li>
)}

// Block body — explicit render required
{for (const el of elements) {
  const name = el.name.toUpperCase()
  const cls = el.active ? 'active' : 'inactive'
  render <p class={cls}>{name}</p>
}}

// For-of with index and key
{for (const item of items; index i; key item.id) (
  <li>{i}: {item.text}</li>
)}

// For-in (iterate object keys)
{for (const key in config) <dt>{key}</dt>}

// C-style for loop
{for (let i = 0; i < count; i++) <span>{i}</span>}

// Destructuring
{for (const { name, age } of people) (
  <p>{name} is {age}</p>
)}
```

### Switch blocks

```tsx
// Expression body per case
{switch (status) {
  case 'loading': <Spinner />; break;
  case 'error': <ErrorMessage />; break;
  default: <Content />
}}

// Block body per case — explicit render required
{switch (status) {
  case 'loading': {
    render <Spinner />
    break
  }
  case 'error': {
    const msg = getErrorMessage(error)
    render <p class="error">{msg}</p>
    break
  }
  default: {
    render <Content />
  }
}}
```

### Try/catch blocks

```tsx
// Expression body
{try (
  <ComponentThatMightFail />
) catch (e) (
  <p>Error: {e.message}</p>
)}

// Block body — explicit render required
{try {
  render <RiskyComponent />
} catch (e) {
  const msg = formatError(e)
  render <div class="error">{msg}</div>
}}

// With pending (suspense)
{try (
  <AsyncComponent />
) pending (
  <Skeleton />
) catch (e) (
  <p>Failed to load</p>
)}
```

## Valid: Standalone Code Blocks

A `{}` that contains statements (not a single expression) is a **code block**. Use `render` to output JSX.

```tsx
// Compute and render
{
  const total = items.reduce((sum, i) => sum + i.price, 0)
  render <p>Total: ${total}</p>
}

// Conditional logic
{
  const greeting = time < 12 ? 'Good morning' : 'Good afternoon'
  const icon = time < 12 ? '🌅' : '☀️'
  render <h2>{icon} {greeting}, {user.name}</h2>
}

// Build complex data
{
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))
  const top5 = sorted.slice(0, 5)
  render <ul>
    {for (const item of top5) <li>{item.name}</li>}
  </ul>
}
```

## Valid: Nested Blocks

Blocks can nest freely.

```tsx
<div>
  {for (const section of sections) {
    render <section>
      <h2>{section.title}</h2>
      {if (section.items.length > 0) (
        <ul>
          {for (const item of section.items) <li>{item}</li>}
        </ul>
      ) else (
        <p>No items</p>
      )}
    </section>
  }}
</div>
```

---

## Logic

Each block is treated like an IIFE internally. The preprocessor decides how to compile:

1. **Expression body** (bare JSX, parenthesized expression) → wrap as `() => expr`
2. **Block body** (contains `{}` after condition/iterator) → treat as function body, `render` compiles to `return`
3. **`if`** → `if_block(condFn, trueFn, falseFn)`
4. **`for`** → `for_block(collFn, bodyFn, keyFn)`
5. **`switch`** → `switch_block(discriminantFn, cases)`
6. **`try`** → `try_block(tryFn, catchFn, pendingFn)`

---

## Invalid / Not Supported

```tsx
// ❌ Block body without render — nothing renders (no error, just empty)
{if (x) {
  <p>This won't render — needs explicit render</p>
}}

// ❌ Mixing bare JSX and render in the same block
{
  <p>Bare JSX</p>
  render <p>Explicit render</p>
}
```

---

## How `render` Differs by Context

render differs nothing between contexts
