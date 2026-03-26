# Control Flow

## If statements

If blocks can be embedded directly in JSX-like expressions using curly braces. This makes control flow easier to read and reason about.

```tsx
export component Truthy(x) {
  render (
    <div>
      {if (x) {
        <span>x is truthy</span>
      } else {
        <span>x is falsy</span>
      }}
    </div>
  );
}
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

Switch statements let you conditionally render content based on a value. They work with both static and reactive values.

```tsx
export component StatusIndicator(status) {
  render (
    <div>
      {switch (status) {
        case 'init':
          // fall-through to the next
        case 'loading':
          <p>Loading...</p>
          break;
        case 'success':
          <p>Success!</p>
          break;
        case 'error':
          <p>Error!</p>
          break;
        default:
          <p>Unknown status</p>
      }}
    </div>
  );
}
```

You can also use reactive values with switch statements.

```tsx
export component InteractiveStatus() {
  state status = 'loading';

  render (
    <div>
      <button onclick={() => status = 'success'}>Success</button>
      <button onclick={() => status = 'error'}>Error</button>

      <div>
        {switch (status) {
          case 'init':
            <p>Init</p>
            // fall-through to the next
          case 'loading':
            <p>Loading...</p>
            break;
          case 'success':
            <p>Success!</p>
            break;
          case 'error':
            <p>Error!</p>
            break;
          default:
            <p>Unknown status</p>
        }}
      </div>
    </div>
  );
}
```

## For statements

You can render collections using a `for...of` loop embedded in JSX.

```tsx
component ListView(title, items) {
  render (
    <div>
      <h2>{title}</h2>
      <ul>
        {for (const item of items) {
          <li>{item.text}</li>
        }}
      </ul>
    </div>
  );
}

// usage
export default component App() {
  render (
    <ListView
      title="My List"
      items={[
        { text: "Item 1" },
        { text: "Item 2" },
        { text: "Item 3" },
      ]}
    />
  );
}
```

The `for...of` loop has built-in support for accessing the loop's numerical index using `index`:

```tsx
{for (const item of items; index i) {
  <div>{item.label} at index {i}</div>
}}
```

You can also provide a `key` for efficient list updates and reconciliation:

```tsx
{for (const item of items; index i; key item.id) {
  <div>{item.label} at index {i}</div>
}}
```

## Try statements (Error Boundaries)

Try blocks enable error boundaries — when the runtime encounters an error in the `try` block, you can render a fallback in the `catch` block.

```tsx
export component ErrorBoundary() {
  render (
    <div>
      {try {
        <ComponentThatFails />
      } catch (e) {
        <div>An error occurred! {e.message}</div>
      }}
    </div>
  );
}
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
    {try {
      <UserProfile id={1} />
    } pending {
      <p>Loading...</p>
    } catch (e) {
      <p>Error: {e.message}</p>
    }}
  );
}
```

The `pending` clause shows while the component is suspended. The `catch` clause handles both sync throws and async rejections. Both clauses are optional and can be used independently.
