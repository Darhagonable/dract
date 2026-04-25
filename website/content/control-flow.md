---
title: Control Flow
---

# Control Flow

Control flow blocks are embedded directly in JSX using curly braces.

## If statements

Expressions inside `if` blocks are eagerly rendered — bare JSX is output directly:

```tsx
{if (loggedIn) {
  <p>Welcome back!</p>
} else {
  <p>Please sign in.</p>
}}
```

For more complex logic, use full statements with an explicit `render`:

```tsx
{if (loggedIn) {
  const user = getUser();
  render (
    <div>
      <h2>Welcome, {user.name}</h2>
      <p>{user.email}</p>
    </div>
  )
} else {
  <p>Please sign in.</p>
}}
```

### if / else if / else

```tsx
{if (status === 'loading') {
  <Spinner />
} else if (status === 'error') {
  <p>Something went wrong.</p>
} else {
  <Content />
}}
```

---

## Switch statements

```tsx
{switch (status) {
  case 'loading':
    <Spinner />
    break;
  case 'success':
    <p>Done!</p>
    break;
  case 'error':
    <p>Failed.</p>
    break;
  default:
    <p>Unknown</p>
}}
```

Cases support fall-through (omit `break`), just like regular JavaScript switch statements.

---

## For statements

### C-style loop

Traditional C-style `for` loops work in JSX:

```tsx
{for (let i = 0; i < 5; i++) {
  <span>{i}</span>
}}
```

### for...of

Render collections with `for...of`:

```tsx
{for (const item of items) {
  <li>{item.name}</li>
}}
```

### for...in

Use `for...in` to iterate over object keys:

```tsx
{for (const key in obj) {
  <li>{key}: {obj[key]}</li>
}}
```

### Index and key

Access the loop index and provide a key for efficient reconciliation:

```tsx
{for (const item of items; index i; key item.id) {
  <li>{i}: {item.name}</li>
}}
```

---

## Try catch statements

### Error boundaries

Catch errors thrown during rendering:

```tsx
{try {
  <RiskyComponent />
} catch (e) {
  <p>Error: {e.message}</p>
}}
```

### Async (Suspense boundaries)

Handle async components with `pending` and `catch` clauses:

```tsx
async component UserProfile(id: number) {
  const res = await fetch(`/api/users/${id}`);
  const user = await res.json();

  render (
    <h1>{user.name}</h1>
    <p>{user.email}</p>
  )
}

// Usage
{try {
  <UserProfile id={1} />
} pending {
  <p>Loading...</p>
} catch (e) {
  <p>Error: {e.message}</p>
}}
```

The `pending` clause renders while the async component is resolving. The `catch` clause handles both sync throws and async rejections.
