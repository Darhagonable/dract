---
title: Query
---

# Query

The `@dartsx-toolkit/query` package provides reactive data fetching with caching, automatic re-fetching, and cancellation support.

## Installation

```bash
npm install @dartsx-toolkit/query
```

## Queries

Queries fetch data, cache results by arguments, and automatically re-fetch when reactive arguments change.

### defineQuery

Creates a reusable query definition. The `queryFn` receives the arguments you pass when invoking the query, plus an optional `AbortSignal` as the last parameter for cancellation support.

```tsx
import { defineQuery, useQuery } from '@dartsx-toolkit/query';

const postQuery = defineQuery(async (id: number) => {
  const res = await fetch(`/api/posts/${id}`);
  return res.json();
});
```

### useQuery

Subscribes a component to a query. Call the query definition with arguments to create an instance, then pass it to `useQuery`.

```tsx
component PostView(id: number) {
  derived post = useQuery(postQuery(id));
  render (
    {post.loading && <p>Loading...</p>}
    {post.error && <p>Error: {post.error.message}</p>}
    {post.data && <h1>{post.data.title}</h1>}
  );
}
```

Returns a reactive `QueryResult`:

| Property  | Type                  | Description                    |
| --------- | --------------------- | ------------------------------ |
| `data`    | `TData \| undefined`  | The resolved data              |
| `loading` | `boolean`             | Whether a fetch is in progress |
| `success` | `boolean`             | Whether the last fetch succeeded |
| `error`   | `TError \| undefined` | The error from the last fetch  |
| `refetch` | `() => void`          | Manually trigger a re-fetch    |

### Query Options

```ts
useQuery(postQuery(id), {
  refetchInterval: 5000,   // poll every 5 seconds
  onSuccess: (data) => {},
  onError: (error) => {},
  onSettled: (data, error) => {},
});
```

| Option            | Type                                              | Description                            |
| ----------------- | ------------------------------------------------- | -------------------------------------- |
| `refetchInterval` | `number`                                          | Poll interval in milliseconds          |
| `onSuccess`       | `(data: TData) => void`                           | Called on successful fetch             |
| `onError`         | `(error: TError) => void`                         | Called on failed fetch                 |
| `onSettled`       | `(data: TData \| undefined, error: TError \| undefined) => void` | Called after every fetch |

### Conditional Queries

`useQuery` accepts a falsy value instead of a query instance to skip fetching. This enables type-safe conditional queries:

```tsx
component PostView() {
  state selectedId: number | null = null;
  derived post = useQuery(selectedId && postQuery(selectedId));
  render (
    {post.data && <h1>{post.data.title}</h1>}
  );
}
```

When `selectedId` is `null`, the query is skipped and an idle result is returned. When it becomes non-null, TypeScript narrows the type and the query executes. Any falsy value (`false`, `null`, `undefined`, `0`, `''`) works.

### Caching

Results are cached by serialized arguments. Multiple components calling `useQuery(postQuery(1))` share the same cache entry and network request. When all subscribers unmount, the cache entry is retained for future use.

### Invalidation

```ts
// Re-fetch if there are active subscribers, otherwise clear the entry
postQuery.invalidate(1);

// Clear the entire cache
postQuery.clear();
```

### Cancellation

If your `queryFn` accepts an `AbortSignal` as its last parameter, the signal is automatically managed:

- When a new fetch starts while one is in-flight, the previous request is aborted.
- Stale responses from aborted requests are ignored.

```ts
const searchQuery = defineQuery(async (term: string, signal: AbortSignal) => {
  const res = await fetch(`/api/search?q=${term}`, { signal });
  return res.json();
});
```

## Actions

Actions are for mutations — creating, updating, or deleting data. Unlike queries, actions don't cache results or auto-execute.

### defineAction

Creates a reusable action definition:

```tsx
import { defineAction, useAction } from '@dartsx-toolkit/query';

const createPost = defineAction(async (title: string, body: string) => {
  const res = await fetch('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
  return res.json();
});
```

### useAction

Subscribes a component to an action. Returns a callable function with reactive state properties:

```tsx
component CreatePost() {
  derived submit = useAction(createPost, {
    onSuccess: (data) => console.log('Created:', data),
  });

  render (
    <button onclick={() => submit('Hello', 'World')}>
      {submit.loading ? 'Saving...' : 'Create Post'}
    </button>
    {submit.error && <p>Error: {submit.error.message}</p>}
  );
}
```

The returned `ActionResult` is both a function and a reactive object:

| Property  | Type                  | Description                        |
| --------- | --------------------- | ---------------------------------- |
| `data`    | `TData \| undefined`  | The resolved data from last call   |
| `loading` | `boolean`             | Whether an action is in progress   |
| `success` | `boolean`             | Whether the last call succeeded    |
| `error`   | `TError \| undefined` | The error from the last call       |
| `reset`   | `() => void`          | Reset state back to initial values |

### Action Options

```ts
useAction(createPost, {
  onSuccess: (data) => {},
  onError: (error) => {},
  onSettled: (data, error) => {},
});
```
