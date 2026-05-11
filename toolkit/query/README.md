# @dartsx-toolkit/query

## Installation

```bash
npm install @dartsx-toolkit/query
```

## Queries

Queries fetch data, cache results by arguments, and automatically re-fetch when reactive arguments change.

### `defineQuery(queryFn)`

Creates a reusable query definition. The `queryFn` receives the arguments you pass when invoking the query, plus an `AbortSignal` as the last parameter for cancellation support.

```tsx
import { defineQuery, useQuery } from '@dartsx-toolkit/query';

const postQuery = defineQuery(async (id: number, signal: AbortSignal) => {
  const res = await fetch(`/api/posts/${id}`, { signal });
  return res.json();
});
```

The `AbortSignal` parameter is optional — queries work without it. When present, in-flight requests are automatically aborted on re-fetch or component unmount.

### `useQuery(instance, options?)`

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

| Property  | Type                | Description                        |
| --------- | ------------------- | ---------------------------------- |
| `data`    | `TData \| undefined` | The resolved data                  |
| `loading` | `boolean`           | Whether a fetch is in progress     |
| `success` | `boolean`           | Whether the last fetch succeeded   |
| `error`   | `TError \| undefined` | The error from the last fetch      |
| `refetch` | `() => void`        | Manually trigger a re-fetch        |

#### Options

```ts
useQuery(postQuery(id), {
  refetchInterval: 5000,   // poll every 5 seconds
  onSuccess: (data) => {},
  onError: (error) => {},
  onSettled: (data, error) => {},
});
```

| Option            | Type                                              | Description                             |
| ----------------- | ------------------------------------------------- | --------------------------------------- |
| `refetchInterval` | `number`                                          | Poll interval in milliseconds           |
| `onSuccess`       | `(data: TData) => void`                           | Called on successful fetch              |
| `onError`         | `(error: TError) => void`                         | Called on failed fetch                  |
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

### Error Typing

By default, `error` is typed as `unknown`. To narrow it, provide a second type parameter:

```ts
const postQuery = defineQuery<typeof fetchPost, Error>(fetchPost);
```

## Actions

Actions handle mutations (create, update, delete) with loading/error state tracking.

### `defineAction(actionFn)`

Creates a reusable action definition.

```ts
import { defineAction, useAction } from '@dartsx-toolkit/query';

const createPostAction = defineAction(async (title: string) => {
  const res = await fetch('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return res.json();
});
```

### `useAction(action, options?)`

Subscribes a component to an action. Returns a callable `ActionResult` — call it directly to execute the action.

```tsx
component CreatePost() {
  derived createPost = useAction(createPostAction, {
    onSuccess: (data) => postQuery.invalidate(),
  });
  render (
    <button
      onclick={() => createPost('New Post')}
      disabled={createPost.loading}
    >
      {createPost.loading ? 'Creating...' : 'Create'}
    </button>
    {createPost.error && <p>Error: {createPost.error.message}</p>}
  );
}
```

Returns a reactive `ActionResult`:

| Property  | Type                      | Description                              |
| --------- | ------------------------- | ---------------------------------------- |
| `(...args)` | `ReturnType<TActionFn>` | Call to execute the action               |
| `data`    | `TData \| undefined`       | The resolved return value                |
| `loading` | `boolean`                 | Whether the action is in progress        |
| `success` | `boolean`                 | Whether the last execution succeeded     |
| `error`   | `TError \| undefined`      | The error from the last execution        |
| `reset`   | `() => void`              | Reset all state back to initial values   |

#### Options

```ts
useAction(createPostAction, {
  onSuccess: (data) => {},
  onError: (error) => {},
  onSettled: (data, error) => {},
});
```

### Caching

Action results are cached on the action object. Multiple calls to `useAction` with the same action return the same reactive result, sharing state across components.

### Sequential Calls

When an action is called multiple times in quick succession, only the result from the latest call is applied. Earlier in-flight calls are ignored when they resolve.

## API Reference

```ts
// Queries
function defineQuery<TFn, TError = unknown>(queryFn: TFn): Query<TFn, TError>;
function useQuery<TData, TError>(instance: QueryInstance, options?: QueryOptions): QueryResult<TData, TError>;

// Actions
function defineAction<TFn, TError = unknown>(actionFn: TFn): Action<TFn, TError>;
function useAction<TActionFn, TError>(action: Action, options?: ActionOptions): ActionResult<TActionFn, TError>;
```
