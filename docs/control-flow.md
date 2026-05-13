# Control Flow

Control flow blocks are embedded directly in JSX using curly braces. They follow the same semantics as JavaScript arrow functions:

- **Expression body** — bare JSX or parenthesized expression, implicit render
- **Block body `{}`** — requires explicit `render`, just like `return` in a block arrow

## If statements

### Expression body — direct JSX

A single JSX element after the condition is rendered directly:

```tsx
{if (loggedIn) <p>Welcome back!</p>}
```

### Expression body — parenthesized

Use parentheses to group a larger expression across multiple lines:

```tsx
{if (loggedIn) (
  <div>
    <h2>Welcome back!</h2>
    <p>You have 3 new messages.</p>
  </div>
) else (
  <p>Please sign in.</p>
)}
```

### Block body — explicit render

Use a block when you need logic before rendering. `render` is required, just like `return` in a block arrow:

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
  render (<p>Please sign in.</p>)
}}
```

### if / else if / else

```tsx
{if (status === 'loading') (
  <Spinner />
) else if (status === 'error') (
  <p>Something went wrong.</p>
) else (
  <Content data={data} />
)}
```

## Early render (guard clauses)

You can pair `if` blocks with `render` to short-circuit the rest of the component body once a guard branch is hit.

```tsx
export component AuthGate() {
  state is_logged_in = false;

  if (!is_logged_in) {
    render (
      <p>Please sign in.</p>
    );
  }

  render (
    <div>
      <h1>Dashboard</h1>
      <p>Private content</p>
    </div>
  );
}
```

## Switch statements

### Expression body

Each case renders a bare JSX expression:

```tsx
{switch (status) {
  case 'loading': <Spinner />; break;
  case 'success': <p>Done!</p>; break;
  case 'error': <p>Failed.</p>; break;
  default: <p>Unknown</p>
}}
```

### Block body — explicit render

Use a block per case when you need logic:

```tsx
{switch (status) {
  case 'loading': {
    render (<Spinner />)
    break;
  }
  case 'error': {
    const msg = formatError(error);
    render (<p class="error">{msg}</p>)
    break;
  }
  default: {
    render (<Content />)
  }
}}
```

Cases support fall-through (omit `break`), just like regular JavaScript switch statements.

## For statements

### Expression body — direct JSX

```tsx
{for (const item of items) <li>{item.text}</li>}
```

### Expression body — parenthesized

```tsx
{for (const item of items) (
  <li>
    <span>{item.name}</span>
    <span>{item.price}</span>
  </li>
)}
```

### Block body — explicit render

```tsx
{for (const item of items) {
  const cls = item.active ? 'active' : 'inactive';
  render (
    <li class={cls}>{item.name.toUpperCase()}</li>
  )
}}
```

### Index and key

Access the loop index and provide a key for efficient reconciliation:

```tsx
{for (const item of items; index i; key item.id) (
  <li>{i}: {item.name}</li>
)}
```

### Other loop types

```tsx
// C-style for loop
{for (let i = 0; i < 5; i++) <span>{i}</span>}

// for...in
{for (const key in obj) <li>{key}: {obj[key]}</li>}

// Destructuring
{for (const { name, age } of people) (
  <p>{name} is {age}</p>
)}
```

## Try statements (Error Boundaries)

### Expression body

```tsx
{try (
  <ComponentThatFails />
) catch (e) (
  <p>Error: {e.message}</p>
)}
```

### Block body — explicit render

```tsx
{try {
  render (<RiskyComponent />)
} catch (e) {
  const msg = formatError(e);
  render (<div class="error">{msg}</div>)
}}
```

## Async (Suspense boundaries)

Components can use `async component` for async operations. Just like functions the component won't resolve until all the awaited code is resolved.

```tsx
async component UserProfile(id: number) {
  const response = await fetch(`https://api.example.com/users/${id}`);
  const user = await response.json();

  render (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

Wrap the component in a `try/pending` block to handle the suspended state:

```tsx
export component App() {
  render (
    {try (
      <UserProfile id={1} />
    ) pending (
      <p>Loading...</p>
    ) catch (e) (
      <p>Error: {e.message}</p>
    )}
  );
}
```

The `pending` clause shows while the component is suspended. The `catch` clause handles both sync throws and async rejections. Both clauses are optional and can be used independently.
