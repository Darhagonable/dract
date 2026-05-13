# Components

Components are the building blocks of your application. They are independent, reusable pieces of UI.

## Defining a component

A component is defined using the `component` keyword:

```tsx
export component Greeting() {
  render (
    <h1>Hello, World!</h1>
  );
}
```

## Using components

Components are used like HTML tags:

```tsx
export component App() {
  render (
    <Greeting />
  );
}
```

## Passing props to a component

Props let you pass data to components:

```tsx
component Greeting(name: string) {
  render (
    <h1>Hello, {name}!</h1>
  );
}

// Usage
export component App() {
  render (
    <Greeting name="Alice" />
  );
}
```

There are a few important details to notice here:

- The prop parameter names declared in the component are the same as the prop names passed in JSX — `name` in `component Greeting(name: string)` matches `name` in `<Greeting name="Alice" />`.
- The order of the parameters in the declaration does not need to match the order that they are provided in JSX.

### Multiple props

```tsx
component UserCard(name: string, age: number, isOnline: boolean) {
  render (
    <div class="card">
      <h2>{name}</h2>
      <p>Age: {age}</p>
      <span class={isOnline ? "online" : "offline"} />
    </div>
  );
}

// Usage
<UserCard name="Charlie" age={25} isOnline={true} />
```

### Default props

```tsx
component Button(label: string = "Click me", variant: "primary" | "secondary" = "primary") {
  render (
    <button class={variant}>{label}</button>
  );
}

// Usage
<Button />;
<Button label="Submit" />;
<Button label="Cancel" variant="secondary" />
```

### Optional props

```tsx
component Avatar(src?: string, alt: string = "User avatar") {
  render (
    <div>
      {if (src) (
        <img src={src} alt={alt} />
      ) else (
        <div class="avatar-placeholder">{alt[0]}</div>
      )}
    </div>
  );
}
```

### Renamed props (string parameters)

Components allow you to rename parameters, which is useful when the prop name passed by the caller is not a valid JavaScript identifier. Use a string literal followed by `as` and the local variable name:

```tsx
component RenamedParameter(
  'required-renamed' as foo: number,
  'optional-renamed' as bar?: number,
  'optional-with-default-renamed' as baz: number = 3,
) {
  // Inside the component, use the local names:
  // foo: number       — always provided
  // bar: number | void — may be undefined
  // baz: number       — defaults to 3

  render (
    <div>
      <p>{foo}</p>
      <p>{bar}</p>
      <p>{baz}</p>
    </div>
  );
}

// Usage — callers use the string-literal prop names:
<RenamedParameter required-renamed={42} optional-renamed={7} />
```

This is particularly helpful for props whose names contain hyphens or other characters that aren't valid JavaScript identifiers, such as `aria-*` or `data-*` style attributes.

### Rest props

Use spread syntax to accept arbitrary additional props:

```tsx
component Input(type: string = "text", ...rest) {
  render (
    <input {type} {...rest} />
  );
}

// Usage
<Input placeholder="Enter name" class="form-input" />
```

## Children

Components can accept children through the `children` prop:

```tsx
component Card(children) {
  render (
    <div class="card">
      {children}
    </div>
  );
}

// Usage
<Card>
  <h2>About Me</h2>
  <p>I am a software developer.</p>
</Card>
```

### Named children (slots)

For multiple slots, use named props:

```tsx
component Layout(header: Component, sidebar: Component, main: Component) {
  render (
    <div class="layout">
      <header>{header}</header>
      <aside>{sidebar}</aside>
      <main>{main}</main>
    </div>
  );
}

// Usage
<Layout
  header={<h1>My Dashboard</h1>}
  sidebar={<nav>Menu</nav>}
  main={<p>Content here</p>}
/>
```

### Children as a function

Render props pattern:

```tsx
component DataFetcher(children: (data: string) => Component) {
  state data = "Loading...";

  // Simulate data fetch
  setTimeout(() => {
    data = "Hello from server!";
  }, 1000);

  render (
    <div>
      {children(data)}
    </div>
  );
}

// Usage
<DataFetcher>
  {(data) => <p>{data}</p>}
</DataFetcher>
```

## Component composition

Components can be composed together:

```tsx
component Button(label: string, onClick: () => void) {
  render (
    <button onclick={onClick}>{label}</button>
  );
}

component Dialog(title: string, children, isOpen: boolean) {
  render (
    {if (isOpen) (
      <div class="dialog-overlay">
        <div class="dialog">
          <h2>{title}</h2>
          {children}
        </div>
      </div>
    )}
  );
}

// Usage
export component App() {
  state isOpen = false;

  render (
    <Button label="Open Dialog" onClick={() => isOpen = true} />
    <Dialog title="My Dialog" isOpen={isOpen}>
      <p>This is the dialog content.</p>
      <Button label="Close" onClick={() => isOpen = false} />
    </Dialog>
  );
}
```

## Spread props

Pass all properties of an object as props:

```tsx
component Profile(name: string, age: number, avatar: string) {
  render (
    <div class="profile">
      <img src={avatar} alt={name} />
      <h2>{name}</h2>
      <p>{age} years old</p>
    </div>
  );
}

// Usage
state user = {
  name: "Alice",
  age: 30,
  avatar: "alice.jpg"
};

render (
  <Profile {...user} />
);
```
