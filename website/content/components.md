---
title: Components
---

# Components

Components are defined with the `component` keyword. They encapsulate UI, state, and behavior.

## Defining a component

```tsx
export component Greeting() {
  render (
    <h1>Hello, World!</h1>
  )
}
```

Use it like an HTML element:

```tsx
<Greeting />
```

## Props

Props are declared as function parameters:

```tsx
component UserCard(name: string, age: number) {
  render (
    <div>
      <h2>{name}</h2>
      <p>Age: {age}</p>
    </div>
  )
}

// Usage
<UserCard name="Alice" age={30} />
```

### Default values

```tsx
component Button(label: string = "Click me", variant: string = "primary") {
  render <button class={variant}>{label}</button>
}

<Button />
<Button label="Submit" variant="secondary" />
```

### Optional props

```tsx
component Avatar(src?: string) {
  render (
    {if (src) (
      <img src={src} />
    ) else (
      <div class="placeholder">?</div>
    )}
  )
}
```

### Renamed props

When a prop name isn't a valid identifier, use a string with `as`:

```tsx
component Tag('data-type' as dataType: string) {
  render <span>{dataType}</span>
}

<Tag data-type="info" />
```

### Rest props

Collect remaining props with spread syntax:

```tsx
component Input(type: string = "text", ...rest) {
  render <input {type} {...rest} />
}

<Input placeholder="Name" class="form-input" />
```

## Children

Accept nested content through the `children` prop:

```tsx
component Card(children) {
  render (
    <div class="card">{children}</div>
  )
}

<Card>
  <h2>Title</h2>
  <p>Content</p>
</Card>
```

### Named slots

Use multiple props for named content areas:

```tsx
component Layout(header: Component, main: Component) {
  render (
    <div>
      <header>{header}</header>
      <main>{main}</main>
    </div>
  )
}

<Layout header={<h1>Title</h1>} main={<p>Content</p>} />
```

## Composition

Components compose naturally:

```tsx
component Button(label: string, onClick: () => void) {
  render <button onclick={onClick}>{label}</button>
}

export component App() {
  state open = false;

  render (
    <div>
      <Button label="Toggle" onClick={() => open = !open} />
      {if (open)
			  <p>Visible!</p>
			}
    </div>
  )
}
```

## Spread props

Pass an object's properties as props:

```tsx
state user = { name: "Alice", age: 30 };
<UserCard {...user} />
```
