# Styling

## Class Attribute

The `class` attribute accepts more than just a string — it also supports objects and arrays. Truthy values are included as class names, while falsy values are omitted. This behavior is powered by the [clsx](https://github.com/lukeed/clsx) library.

### String

```tsx
<div class="card active">...</div>
```

### Object

Keys with truthy values are included as class names:

```tsx
component Alert(type: string = 'info', dismissible: boolean = false) {
  render (
    <div class={{ alert: true, [`alert-${type}`]: true, dismissible }}>
      ...
    </div>
  );
}
// <div class="alert alert-info"> when dismissible is false
// <div class="alert alert-info dismissible"> when dismissible is true
```

### Array

Mix strings, objects, and nested arrays — falsy values are ignored:

```tsx
state isActive = true;
state isDisabled = false;

<button class={['btn', isActive && 'active', isDisabled && 'disabled']}>
  Click me
</button>
// <button class="btn active">
```

### Combined

```tsx
<div class={['card', { highlighted: isHighlighted, 'card--large': size === 'lg' }]}>
  ...
</div>
```

## Style Attribute

The `style` attribute accepts an object, similar to React. Property names use camelCase:

```tsx
<div style={{ color: 'red', fontSize: '14px', marginTop: '8px' }}>
  Styled text
</div>
```

### Reactive Styles

Style values can be reactive:

```tsx
state color = 'blue';
state size = 16;

<p style={{ color, fontSize: `${size}px` }}>
  Dynamic styling
</p>
```

### Units

Numeric values for properties that accept pixel units are automatically suffixed with `px`:

```tsx
<div style={{ width: 200, padding: 16 }}>
  200px wide, 16px padding
</div>
```

### Vendor Prefixes

Use camelCase for vendor-prefixed properties:

```tsx
<div style={{ WebkitTransform: 'rotate(45deg)', msFilter: 'blur(5px)' }}>
  ...
</div>
```
