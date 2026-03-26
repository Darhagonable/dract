# Framework Comparison

This document compares this framework to React and Svelte, highlighting the key differences and similarities in syntax, reactivity model, and developer experience.

## Table of Contents

- [Component Definition](#component-definition)
- [State Management](#state-management)
- [Reactivity Model](#reactivity-model)
- [Control Flow](#control-flow)
- [JSX/TSX Syntax Differences](#jsxtsx-syntax-differences)
- [Event Handling](#event-handling)
- [Two-Way Binding](#two-way-binding)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Effects](#effects)
- [Error Handling](#error-handling)
- [Async Components](#async-components)

---

## Component Definition

### This Framework
```tsx
component Greeting(name: string = "World") {
  render (
    <h1>Hello, {name}!</h1>
  );
}
```

### React
```jsx
function Greeting({ name = "World" }) {
  return <h1>Hello, {name}!</h1>;
}

// or with TypeScript
interface GreetingProps {
  name?: string;
}

function Greeting({ name = "World" }: GreetingProps) {
  return <h1>Hello, {name}!</h1>;
}
```

### Svelte (v5 with runes)
```svelte
<script lang="ts">
  let { name = "World" }: { name?: string } = $props();
</script>

<h1>Hello, {name}!</h1>
```

**Key Differences:**
- This framework uses a dedicated `component` keyword with inline props typing
- React uses regular functions with props as an object parameter
- Svelte uses the `$props()` rune inside a `<script>` tag
- This framework requires an explicit `render` function, while React uses implicit return

---

## State Management

### This Framework
```tsx
component Counter() {
  state count = 0;
  render (
    <button onclick={() => count++}>{count}</button>
  );
}
```

### React
```jsx
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(c => c + 1)}>{count}</button>
  );
}
```

### Svelte (v5)
```svelte
<script>
  let count = $state(0);
</script>

<button onclick={() => count++}>{count}</button>
```

**Key Differences:**
- This framework uses a `state` keyword that creates a reactive primitive directly
- React requires a getter/setter pair via `useState`
- Svelte v5 uses `$state()` rune
- This framework and Svelte allow direct mutation (`count++`), while React requires a setter call
- This framework creates deeply reactive proxies for objects/arrays automatically

---

## Reactivity Model

### Derived State

#### This Framework
```tsx
state count = 0;
derived doubled = count * 2;
```

#### React
```jsx
const [count, setCount] = useState(0);
const doubled = useMemo(() => count * 2, [count]);
```

#### Svelte
```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>
```

### Deep Reactivity

#### This Framework
```tsx
state todos = [{ done: false, text: 'add todos' }];
todos[0].done = !todos[0].done; // triggers update
```

#### React
```jsx
const [todos, setTodos] = useState([{ done: false, text: 'add todos' }]);

// Must create new array/object reference
setTodos(prev => {
  const newTodos = [...prev];
  newTodos[0] = { ...newTodos[0], done: !newTodos[0].done };
  return newTodos;
});
```

#### Svelte
```svelte
<script>
  let todos = $state([{ done: false, text: 'add todos' }]);
  todos[0].done = !todos[0].done; // triggers update
</script>
```

**Key Differences:**
- This framework and Svelte support deep reactivity through proxies
- React requires immutable updates and new object references
- This framework uses a `derived` keyword; Svelte uses `$derived()`; React uses `useMemo`
- This framework uses push-pull reactivity (immediate notification, lazy evaluation)

---

## Control Flow

### Conditionals

#### This Framework
```tsx
<div>
  {if (isLoading) {
    <p>Loading...</p>
  } else {
    <p>Done!</p>
  }}
</div>
```

#### React
```jsx
<div>
  {isLoading ? <p>Loading...</p> : <p>Done!</p>}
  {/* or */}
  {isLoading && <p>Loading...</p>}
</div>
```

#### Svelte
```svelte
<div>
  {#if isLoading}
    <p>Loading...</p>
  {:else}
    <p>Done!</p>
  {/if}
</div>
```

### Loops

#### This Framework
```tsx
<ul>
  {for (const item of items; key item.id) {
    <li>{item.name}</li>
  }}
</ul>
```

#### React
```jsx
<ul>
  {items.map(item => (
    <li key={item.id}>{item.name}</li>
  ))}
</ul>
```

#### Svelte
```svelte
<ul>
  {#each items as item (item.id)}
    <li>{item.name}</li>
  {/each}
</ul>
```

**Key Differences:**
- This framework embeds actual JavaScript control flow (if, for, switch) in JSX
- React uses JavaScript expressions (ternaries, map) within JSX
- Svelte uses template syntax with special blocks (#if, #each)
- This framework's approach feels more like writing regular JavaScript

---

## JSX/TSX Syntax Differences

### Multiple Root Elements (No Fragments Needed)

#### This Framework
```tsx
component Page() {
  render (
    <header>Header</header>
    <main>Content</main>
    <footer>Footer</footer>
  );
}
```

#### React (Requires Fragment or Wrapper)
```jsx
function Page() {
  return (
    <>
      <header>Header</header>
      <main>Content</main>
      <footer>Footer</footer>
    </>
  );
}
```

#### Svelte
```svelte
<header>Header</header>
<main>Content</main>
<footer>Footer</footer>
```

**Key Differences:**
- This framework allows multiple top-level elements in `render` without any wrapper
- React requires fragments (`<>...</>`) or a wrapper div
- Svelte naturally supports multiple root elements (it's just HTML)

### Multiple Statements in Render (Early Returns)

#### This Framework
```tsx
component Dashboard() {
  state user = { name: "Alice", role: "admin" };
  state stats = { users: 100, posts: 50 };

  if (!user) {
    render <LoginPrompt />;
  }

  render (
    <div class="dashboard">
      <h1>Welcome, {user.name}</h1>
      <Stats {...stats} />
    </div>
  );
}
```

#### React
```jsx
function Dashboard() {
  const [user, setUser] = useState({ name: "Alice", role: "admin" });
  const [stats, setStats] = useState({ users: 100, posts: 50 });

  if (!user) {
    return <LoginPrompt />;
  }

  return (
    <div class="dashboard">
      <h1>Welcome, {user.name}</h1>
      <Stats {...stats} />
    </div>
  );
}
```

#### Svelte
```svelte
<script>
  let user = $state({ name: "Alice", role: "admin" });
  let stats = $state({ users: 100, posts: 50 });
</script>

{#if !user}
  <LoginPrompt />
{:else}
  <div class="dashboard">
    <h1>Welcome, {user.name}</h1>
    <Stats {...stats} />
  </div>
{/if}
```

**Key Differences:**
- This framework allows early `render` returns (guard clauses) and later full render
- React requires a single `return` statement for all JSX output
- Svelte uses template conditionals (`{#if}...{:else}...{/if}`)
- This framework's `render` can appear multiple times for early exits

### Render as Statement vs Expression

#### This Framework (render is a statement)
```tsx
component App() {
  state items = [];
  derived total = items.reduce((a, b) => a + b, 0);

  render (
    <div>Total: {total}</div>
  );
  // Any code here is unreachable
}
```

#### React (return is an expression)
```jsx
function App() {
  const [items, setItems] = useState([]);
  const total = items.reduce((a, b) => a + b, 0);

  return (
    <div>Total: {total}</div>
  );
  // Any code here is unreachable
}
```

**Key Differences:**
- This framework's `render` is a statement that can be followed by other code
- React's `return` is an expression that ends the function execution
- This framework allows code after `render` (though not recommended)
- This framework's design makes early returns more natural with `render` as statement

### Attribute Spreading Differences

#### This Framework
```tsx
component Button(label: string, ...rest) {
  render (
    <button {label} {...rest} />
  );
}
```

#### React
```jsx
function Button({ label, ...rest }) {
  return <button {...rest}>{label}</button>;
}
```

#### Svelte
```svelte
<script>
  let { label, ...rest } = $props();
</script>

<button {...rest}>{label}</button>
```

**Key Differences:**
- This framework uses shorthand `{prop}` for setting attributes (like Svelte's `{prop}`)
- React always uses `{prop}` for expressions, attributes use `prop={value}` syntax
- All three support spread operator `{...props}`

### Class vs className

#### This Framework
```tsx
<div class="container active">...</div>
```

#### React
```jsx
<div className="container active">...</div>
```

#### Svelte
```svelte
<div class="container active">...</div>
```

**Key Differences:**
- This framework uses `class` (standard HTML attribute)
- React uses `className` (reserved word conflict)
- Svelte uses `class` (standard HTML attribute)directive

---

## Event Handling

### This Framework
```tsx
<button onclick={count++}>Add</button>
<button onclick={() => handler(arg)}>Click</button>
<button onclick={handleClick}>Click</button>
```

### React
```jsx
<button onClick={() => setCount(c => c + 1)}>Add</button>
<button onClick={() => handler(arg)}>Click</button>
<button onClick={handleClick}>Click</button>
```

### Svelte
```svelte
<button onclick={() => count++}>Add</button>
<button onclick={() => handler(arg)}>Click</button>
<button onclick={handleClick}>Click</button>
```

**Key Differences:**
- This framework uses lowercase event names (`onclick`, `oninput`)
- React uses camelCase (`onClick`, `onInput`)
- Svelte uses lowercase (`onclick`, `oninput`)
- This framework allows inline expressions without arrow functions (`onclick={count++}`)

---

## Two-Way Binding

### This Framework
```tsx
state name = "";

<input bind:value={name} />
```

### React
```jsx
const [name, setName] = useState("");

<input value={name} onChange={e => setName(e.target.value)} />
```

### Svelte
```svelte
<script>
  let name = "";
</script>

<input bind:value={name} />
```

**Key Differences:**
- This framework and Svelte have built-in two-way binding with `bind:`
- React requires manual value/onChange pairing

---

## Lifecycle Hooks

### This Framework
```tsx
import { onMount, onCleanup, onDestroy } from 'this-framework';

component App() {
  onMount(() => {
    console.log('mounted');
    onCleanup(() => console.log('cleanup'));
  });
}
```

### React
```jsx
import { useEffect, useEffectCleanup } from 'react';

function App() {
  useEffect(() => {
    console.log('mounted');
    return () => console.log('cleanup');
  }, []);
}
```

### Svelte
```svelte
<script>
  import { onMount, onDestroy } from 'svelte';

  onMount(() => {
    console.log('mounted');
    return () => console.log('cleanup');
  });
</script>
```

**Key Differences:**
- This framework has separate `onMount` and `onDestroy` hooks, plus `onCleanup` for effects
- React combines mount/unmount in `useEffect` with dependency array
- Svelte has separate `onMount` and `onDestroy`
- This framework has no "before update"/"after update" hooks (updates are granular to effects)

---

## Effects

### This Framework
```tsx
import { effect, onCleanup } from 'this-framework';

state count = 0;

effect(count, (count, prevCount) => {
  console.log(`Count: ${prevCount} -> ${count}`);
});
```

### React
```jsx
const [count, setCount] = useState(0);
const prevCountRef = useRef(count);

useEffect(() => {
  console.log(`Count: ${prevCountRef.current} -> ${count}`);
  prevCountRef.current = count;
}, [count]);
```

### Svelte
```svelte
<script>
  let count = $state(0);
  let prevCount = count;

  $effect(() => {
    console.log(`Count: ${prevCount} -> ${count}`);
    prevCount = count;
  });
</script>
```

**Key Differences:**
- This framework `effect` provides explicit previous values
- React requires manual tracking of previous values (usually with useRef)
- Svelte's `$effect` tracks dependencies automatically
- This framework supports deep property watching: `effect(obj.count, ...)`

---

## Error Handling

### This Framework
```tsx
<div>
  {try {
    <RiskyComponent />
  } catch (e) {
    <p>Error: {e.message}</p>
  }}
</div>
```

### React
```jsx
<ErrorBoundary fallback={<p>Something went wrong</p>}>
  <RiskyComponent />
</ErrorBoundary>
```

### Svelte
```svelte
<svelte:boundary onerror={handler}>
  <RiskyComponent />
</svelte:boundary>
```

**Key Differences:**
- This framework has built-in try/catch in templates
- React requires a separate Error Boundary component
- Svelte includes a built in <svelte:boundary> component 
- This framework integrates error handling directly into control flow

---

## Async Components

### This Framework
```tsx
async component UserProfile(id: number) {
  const response = await fetch(`https://api.example.com/users/${id}`);
  const user = await response.json();

  render (
    <div>
      <h1>{user.name}</h1>
    </div>
  );
}

// Usage with suspense
{try {
  <UserProfile id={1} />
} pending {
  <p>Loading...</p>
} catch (e) {
  <p>Error: {e.message}</p>
}}
```

### React
```jsx
async function UserProfile({ id }) {
  const response = await fetch(`https://api.example.com/users/${id}`);
  const user = await response.json();

  return <div><h1>{user.name}</h1></div>;
}

// Usage with Suspense
<Suspense fallback={<p>Loading...</p>}>
  <UserProfile id={1} />
</Suspense>
```

### Svelte
```svelte
<script>
  import { Suspense } from 'svelte';

  async function loadUser(id) {
    const response = await fetch(`https://api.example.com/users/${id}`);
    return await response.json();
  }
</script>

{#await loadUser(1)}
  <p>Loading...</p>
{:then user}
  <div><h1>{user.name}</h1></div>
{:catch error}
  <p>Error: {error.message}</p>
{/await}
```

**Key Differences:**
- This framework uses `async component` with try/pending/catch syntax
- React uses async components with Suspense boundaries
- Svelte uses `{#await}` blocks in templates
- This framework's syntax is most similar to JavaScript async/await patterns

---

## Summary

| Feature | This Framework | React | Svelte |
|---------|----------------|-------|--------|
| Syntax | TSX with `component` keyword | JSX | HTML-based templates |
| State | `state` keyword | `useState` hook | `$state()` rune |
| Derived | `derived` keyword | `useMemo` hook | `$derived()` rune |
| Multiple roots | No wrapper needed | Fragment | No wrapper needed |
| Early returns | Multiple `render` statements | Early `return` | Template conditionals |
| Two-way binding | `bind:` directive | Manual onChange | `bind:` directive |
| Control flow | Embedded if/for/switch | JS expressions (map, ternary) | #if, #each blocks |
| Events | Lowercase (`onclick`) | CamelCase (`onClick`) | Lowercase (`onclick`) |
| Class attribute | `class` | `className` | `class:` directive |
| Deep reactivity | Proxies (automatic) | Immutable (manual) | Proxies (automatic) |
| Previous values | Built into `effect` | Manual (useRef) | Manual |
| Error handling | `try/catch` in templates | Error Boundary components | `<svelte:boundary>` |
| Compilation | Compile-time | Runtime (with JSX transform) | Compile-time |

### Philosophy Comparison

- **This Framework**: Combines the compile-time optimization of Svelte with the familiar JSX syntax of React. Adds JavaScript-like control flow directly in templates. Uses standard HTML attributes (`class`, `onclick`) and `render` as a statement for more flexible component structure with multiple root elements and early returns.

- **React**: Runtime framework with virtual DOM. Emphasizes explicit state updates and functional composition. Huge ecosystem. Uses JSX as expressions, requires fragments for multiple roots (historically), and uses `className` instead of `class`.

- **Svelte**: Compile-time framework that converts components to vanilla JavaScript. Minimal runtime overhead. HTML-centric syntax with template blocks. No wrapper needed for multiple roots.
