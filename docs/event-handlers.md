# Event Handlers

## Three Ways to Handle Events

This framework supports multiple patterns for event handling:

```tsx
export component Counter() {
  state count = 0;

  const increment = () => {
    count++;
  };

  render (
    <button onclick={count++}>Add 1</button>
    <button onclick={() => count++}>Add 1</button>
    <button onclick={increment}>Add 1</button>
    <p>Count: {count}</p>
  );
}
```

**Inline expressions:** `{count++}`, `{isOpen = !isOpen}`, `{items.push(item)}`

**Arrow functions:** `{() => count++}`, `{() => handler(arg)}`

**Method references:** `{increment}`, `{greet}`

## Method vs. Inline Detection

The template compiler detects method handlers by checking whether the prop is a valid JavaScript identifier or property access path. For example, `foo`, `foo.bar` and `foo['bar']` are treated as method handlers, while `foo()` and `count++` are treated as inline handlers.
