---
title: Bindings
---

# Bindings

Bindings create two-way data flow between an element and a variable using `bind:property`.

## Input value

```tsx
state message = "";

<input bind:value={message} />
<p>{message}</p>
```

Shorthand when variable name matches the property:

```tsx
state value = "";
<input bind:{value} />
```

Numeric inputs (`type="number"`, `type="range"`) automatically coerce to numbers.

## Checkbox

```tsx
state accepted = false;
<input type="checkbox" bind:checked={accepted} />
```

## Radio group

```tsx
state color = "red";

<label><input type="radio" bind:group={color} value="red" /> Red</label>
<label><input type="radio" bind:group={color} value="blue" /> Blue</label>
```

Grouped checkboxes populate an array:

```tsx
state toppings: string[] = [];

<label><input type="checkbox" bind:group={toppings} value="cheese" /> Cheese</label>
<label><input type="checkbox" bind:group={toppings} value="peppers" /> Peppers</label>
```

## Select

```tsx
state selected = "a";

<select bind:value={selected}>
  <option value="a">A</option>
  <option value="b">B</option>
</select>
```

`<select multiple>` binds to an array.

## Function bindings

For validation or transformation, use `bind:property={get, set}`:

```tsx
<input bind:value={
  () => value,
  (v) => value = v.toLowerCase()
} />
```

## Dimensions (readonly)

Bind to element dimensions measured via `ResizeObserver`:

```tsx
state w = 0;
state h = 0;

<div bind:offsetWidth={w} bind:offsetHeight={h}>
  {w} × {h}
</div>
```

Available: `clientWidth`, `clientHeight`, `offsetWidth`, `offsetHeight`, `scrollWidth`, `scrollHeight`, `contentRect`, `contentBoxSize`, `borderBoxSize`.

## bind:this

Get a reference to a DOM element:

```tsx
let canvas: HTMLCanvasElement;

effect(() => {
  const ctx = canvas.getContext('2d');
  // draw
});

render <canvas bind:this={canvas} />
```

## Component bindings

Bind to component props with `bind:property`. The component must declare the prop as bindable:

```tsx
component Slider(bind value: number = 50) {
  render <input type="range" bind:value={value} />
}

// Parent
state volume = 75;
<Slider bind:value={volume} />
```
