# JSX Block Expressions Spec

Inside JSX, `{}` can contain **any JavaScript** — not just single expressions. The `render` keyword outputs JSX from within a code block.

## Design Principles

1. **OXC does the heavy lifting** — we preprocess minimal custom syntax (`render`, `state`, `derived`, `component`) and let OXC parse everything else.
2. **Eager rendering** — if a `{}` contains only a single expression (value, JSX, ternary, function call), it's rendered directly without needing `render`.
3. **Explicit rendering** — if a `{}` contains statements (variable declarations, loops with logic, etc.), use `render` to output JSX.
4. **No special-casing** — `.map()`, `.filter()`, `.reduce()` etc. are just expressions. No compiler magic for specific method names.

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

### If blocks

```tsx
// Simple — body is just JSX (eager, no render needed)
{if (show) {
  <p>Visible</p>
}}

// With else
{if (show) {
  <p>Visible</p>
} else {
  <p>Hidden</p>
}}

// With code before render
{if (user.isAdmin) {
  const greeting = `Welcome back, ${user.name}`
  render <h1>{greeting}</h1>
} else {
  render <p>Access denied</p>
}}

// Else-if chain
{if (status === 'loading') {
  render <Spinner />
} else if (status === 'error') {
  const msg = formatError(error)
  render <p class="error">{msg}</p>
} else {
  <Dashboard data={data} />
}}
```

### For loops

```tsx
// Simple for-of — body is just JSX (eager)
{for (const item of items) {
  <li>{item.text}</li>
}}

// For-of with code before render
{for (const el of elements) {
  const name = el.name.toUpperCase()
  const cls = el.active ? 'active' : 'inactive'
  render <p class={cls}>{name}</p>
}}

// For-of with index and key
{for (const item of items; index i; key item.id) {
  render <li>{i}: {item.text}</li>
}}

// For-in (iterate object keys)
{for (const key in config) {
  render <dt>{key}</dt>
}}

// C-style for loop
{for (let i = 0; i < count; i++) {
  render <span>{i}</span>
}}

// Destructuring
{for (const { name, age } of people) {
  render <p>{name} is {age}</p>
}}
```

### Switch blocks

```tsx
// Simple switch
{switch (status) {
  case 'loading':
    <Spinner />
    break
  case 'error':
    <ErrorMessage />
    break
  default:
    <Content />
}}

// With code before render
{switch (status) {
  case 'loading':
    render <Spinner />
    break
  case 'error':
    const msg = getErrorMessage(error)
    render <p class="error">{msg}</p>
    break
  default:
    render <Content />
}}
```

### Try/catch blocks

```tsx
// Simple
{try {
  <ComponentThatMightFail />
} catch (e) {
  <p>Error: {e.message}</p>
}}

// With code
{try {
  render <RiskyComponent />
} catch (e) {
  const msg = formatError(e)
  render <div class="error">{msg}</div>
}}

// With pending (suspense)
{try {
  render <AsyncComponent />
} pending {
  render <Skeleton />
} catch (e) {
  render <p>Failed to load</p>
}}
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
    {for (const item of top5) {
      <li>{item.name}</li>
    }}
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
      {if (section.items.length > 0) {
        <ul>
          {for (const item of section.items) {
            render <li>{item}</li>
          }}
        </ul>
      } else {
        <p>No items</p>
      }}
    </section>
  }}
</div>
```

---

## Logic

actually we barely have to do any logic at all. we can basically treat each block like if it was an IIFE in react

How the preprocessor decides what kind of block a `{}` contains:

1. single expression (existing behavior)
2. **Contains statements** (variable declarations, multiple statements, `render` keyword) → code block
3. **if within the block gets handled like if
4. **for within the block gets treated like 4 but with the added features
5. **switch within the block gets treated as switch
6. **try within the block gets treates as try but with the added pending featuere

---

## Invalid / Not Supported

```tsx
// ❌ Mixing bare JSX and render in the same block
{
  <p>Bare JSX</p>
  render <p>Explicit render</p>
}
```

---

## How `render` Differs by Context

render differs nothing between contexts