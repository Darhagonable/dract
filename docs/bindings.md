# Bindings

Data ordinarily flows down, from parent to child. The `bind:` directive allows data to flow the other way, from child to parent.

The general syntax is `bind:property={expression}`, where `expression` is an [_lvalue_](https://press.rebus.community/programmingfundamentals/chapter/lvalue-and-rvalue/) (i.e. a variable or an object property). When the expression is an identifier with the same name as the property, we can use a shorthand syntax — in other words these are equivalent:

```tsx
<input bind:value={value} />
<input bind:{value} />
```

The framework creates an event listener that updates the bound value. If an element already has a listener for the same event, that listener will be fired before the bound value is updated.

Most bindings are _two-way_, meaning that changes to the value will affect the element and vice versa. A few bindings are _readonly_, meaning that changing their value will have no effect on the element.

## Function bindings

You can also use `bind:property={get, set}`, where `get` and `set` are functions, allowing you to perform validation and transformation:

```tsx
<input bind:value={
  () => value,
  (v) => value = v.toLowerCase()}
/>
```

In the case of readonly bindings like [dimension bindings](#Dimensions), the `get` value should be `null`:

```tsx
<div
  bind:clientWidth={null, redraw}
  bind:clientHeight={null, redraw}
>...</div>
```

## `<input bind:value>`

A `bind:value` directive on an `<input>` element binds the input's `value` property:

```tsx
export component Form() {
  state message = "hello";

  render (
    <input bind:value={message} />
    <p>{message}</p>
  );
}
```

In the case of a numeric input (`type="number"` or `type="range"`), the value will be coerced to a number:

```tsx
export component Calculator() {
  state a = 1;
  state b = 2;

  render (
    <label>
      <input type="number" bind:value={a} min="0" max="10" />
      <input type="range" bind:value={a} min="0" max="10" />
    </label>

    <label>
      <input type="number" bind:value={b} min="0" max="10" />
      <input type="range" bind:value={b} min="0" max="10" />
    </label>

    <p>{a} + {b} = {a + b}</p>
  );
}
```

If the input is empty or invalid (in the case of `type="number"`), the value is `undefined`.

If an `<input>` has a `defaultValue` and is part of a form, it will revert to that value instead of the empty string when the form is reset. Note that for the initial render the value of the binding takes precedence unless it is `null` or `undefined`.

```tsx
export component Form() {
  state value = "";

  render (
    <form>
      <input bind:value defaultValue="not the empty string" />
      <input type="reset" value="Reset" />
    </form>
  );
}
```

## `<input bind:checked>`

Checkbox inputs can be bound with `bind:checked`:

```tsx
<label>
  <input type="checkbox" bind:checked={accepted} />
  Accept terms and conditions
</label>
```

If an `<input>` has a `defaultChecked` attribute and is part of a form, it will revert to that value instead of `false` when the form is reset. Note that for the initial render the value of the binding takes precedence unless it is `null` or `undefined`.

```tsx
export component Form() {
  state checked = true;

  render (
    <form>
      <input type="checkbox" bind:checked defaultChecked={true} />
      <input type="reset" value="Reset" />
    </form>
  );
}
```

> [!NOTE] Use `bind:group` for radio inputs instead of `bind:checked`.

## `<input bind:indeterminate>`

Checkboxes can be in an [indeterminate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/indeterminate) state, independently of whether they are checked or unchecked:

```tsx
export component Checkbox() {
  state checked = false;
  state indeterminate = true;

  render (
    <form>
      <input type="checkbox" bind:checked bind:indeterminate />

      {if (indeterminate) {
        <p>waiting...</p>
      } else if (checked) {
        <p>checked</p>
      } else {
        <p>unchecked</p>
      }}
    </form>
  );
}
```

## `<input bind:group>`

Inputs that work together can use `bind:group`:

```tsx
export component BurritoChooser() {
  state tortilla = "Plain";
  state fillings: Array<string> = [];

  render (
    {/* grouped radio inputs are mutually exclusive */}
    <label><input type="radio" bind:group={tortilla} value="Plain" /> Plain</label>
    <label><input type="radio" bind:group={tortilla} value="Whole wheat" /> Whole wheat</label>
    <label><input type="radio" bind:group={tortilla} value="Spinach" /> Spinach</label>

    {/* grouped checkbox inputs populate an array */}
    <label><input type="checkbox" bind:group={fillings} value="Rice" /> Rice</label>
    <label><input type="checkbox" bind:group={fillings} value="Beans" /> Beans</label>
    <label><input type="checkbox" bind:group={fillings} value="Cheese" /> Cheese</label>
    <label><input type="checkbox" bind:group={fillings} value="Guac (extra)" /> Guac (extra)</label>
  );
}
```

> [!NOTE] `bind:group` only works if the inputs are in the same component.

## `<input bind:files>`

On `<input>` elements with `type="file"`, you can use `bind:files` to get the [`FileList` of selected files](https://developer.mozilla.org/en-US/docs/Web/API/FileList). When you want to update the files programmatically, you always need to use a `FileList` object. Currently `FileList` objects cannot be constructed directly, so you need to create a new [`DataTransfer`](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer) object and get `files` from there.

```tsx
export component FileUpload() {
  state files;

  function clear() {
		files = new DataTransfer().files; // null or undefined does not work
	}

  render (
    <label for="avatar">Upload a picture:</label>
    <input accept="image/png, image/jpeg" bind:files id="avatar" name="avatar" type="file" />
    <button onclick={clear}>clear</button>
  );
}
```

`FileList` objects also cannot be modified, so if you want to e.g. delete a single file from the list, you need to create a new `DataTransfer` object and add the files you want to keep.

## `<select bind:value>`

A `<select>` value binding corresponds to the `value` property on the selected `<option>`, which can be any value (not just strings, as is normally the case in the DOM).

```tsx
<select bind:value={selected}>
	<option value={a}>a</option>
	<option value={b}>b</option>
	<option value={c}>c</option>
</select>
```

A `<select multiple>` element behaves similarly to a checkbox group. The bound variable is an array with an entry corresponding to the `value` property of each selected `<option>`.

```tsx
<select multiple bind:value={fillings}>
	<option value="Rice">Rice</option>
	<option value="Beans">Beans</option>
	<option value="Cheese">Cheese</option>
	<option value="Guac (extra)">Guac (extra)</option>
</select>
```

When the value of an `<option>` matches its text content, the attribute can be omitted.

```tsx
<select multiple bind:value={fillings}>
	<option>Rice</option>
	<option>Beans</option>
	<option>Cheese</option>
	<option>Guac (extra)</option>
</select>
```

You can give the `<select>` a default value by adding a `selected` attribute to the `<option>` (or options, in the case of `<select multiple>`) that should be initially selected. If the `<select>` is part of a form, it will revert to that selection when the form is reset. Note that for the initial render the value of the binding takes precedence if it's not `undefined`.

```tsx
<select bind:value={selected}>
	<option value={a}>a</option>
	<option value={b} selected>b</option>
	<option value={c}>c</option>
</select>
```

## `<audio>`

`<audio>` elements have their own set of bindings — five two-way ones...

- [`currentTime`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)
- [`playbackRate`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate)
- [`paused`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/paused)
- [`volume`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume)
- [`muted`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/muted)

...and six readonly ones:

- [`duration`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/duration)
- [`buffered`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/buffered)
- [`seekable`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seekable)
- [`seeking`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeking_event)
- [`ended`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/ended)
- [`readyState`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/readyState)
- [`played`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/played)

```tsx
<audio src={clip} bind:duration bind:currentTime bind:paused />
```

## `<video>`

`<video>` elements have all the same bindings as [`<audio>`](#audio) elements, plus readonly [`videoWidth`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/videoWidth) and [`videoHeight`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/videoHeight) bindings.

## `<img>`

`<img>` elements have three readonly bindings:

- [`naturalWidth`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/naturalWidth)
- [`naturalHeight`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/naturalHeight)
- [`complete`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/complete)

## `<details bind:open>`

`<details>` elements support binding to the `open` property.

```tsx
<details bind:open={isOpen}>
  <summary>How do you comfort a JavaScript bug?</summary>
  <p>You console it.</p>
</details>
```

## Contenteditable bindings

Elements with the `contenteditable` attribute support the following bindings:

- [`innerHTML`](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML)
- [`innerText`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText)
- [`textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent)

> [!NOTE] There are [subtle differences between `innerText` and `textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent#differences_from_innertext).

```tsx
<div contenteditable="true" bind:innerHTML={html} />
```

## Dimensions

All visible elements have the following readonly bindings, measured with a `ResizeObserver`:

- [`clientWidth`](https://developer.mozilla.org/en-US/docs/Web/API/Element/clientWidth)
- [`clientHeight`](https://developer.mozilla.org/en-US/docs/Web/API/Element/clientHeight)
- [`scrollWidth`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth)
- [`scrollHeight`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight)
- [`offsetWidth`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/offsetWidth)
- [`offsetHeight`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/offsetHeight)
- [`contentRect`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/contentRect)
- [`contentBoxSize`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/contentBoxSize)
- [`borderBoxSize`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/borderBoxSize)
- [`devicePixelContentBoxSize`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/devicePixelContentBoxSize)

```tsx
<div bind:offsetWidth={width} bind:offsetHeight={height}>
	<Chart {width} {height} />
</div>
```

> [!NOTE] `display: inline` elements do not have a width or height (except for elements with 'intrinsic' dimensions, like `<img>` and `<canvas>`), and cannot be observed with a `ResizeObserver`. You will need to change the `display` style of these elements to something else, such as `inline-block`. Note that CSS transformations do not trigger `ResizeObserver` callbacks.

## bind:this

To get a reference to a DOM node, use `bind:this`. The value will be `undefined` until the component is mounted — in other words, you should read it inside an effect or an event handler, but not during component initialisation:

```tsx
export component CanvasDrawing() {
  let canvas: HTMLCanvasElement;

  function drawStuff(ctx: CanvasRenderingContext2D) {
    // drawing logic
  }

  effect(() => {
    const ctx = canvas.getContext("2d");
    drawStuff(ctx);
  });

  render (
    <canvas bind:this={canvas} />
  );
}
```

Components also support `bind:this`, allowing you to interact with component instances programmatically.

```tsx
<ShoppingCart bind:this={cart} />

<button onclick={() => cart.empty()}> Empty shopping cart </button>
```

## bind:_property_ for components

You can bind to component props using the same syntax as for elements.

```tsx
<Keypad bind:value={pin} />
```

While props are reactive without binding, that reactivity only flows downward into the component by default. Using `bind:property` allows changes to the property from within the component to flow back up out of the component.

To mark a property as bindable, use the `bind` keyword in the prop declaration:

```tsx
component Keypad(readonlyProperty, bind bindableProperty) {}
```

Declaring a property as bindable means it _can_ be used using `bind:`, not that it _must_ be used using `bind:`.

Bindable properties can have a fallback value:

```tsx
component Keypad(bind bindableProperty = "fallback value") {}
```

This fallback value _only_ applies when the property is _not_ bound. When the property is bound and a fallback value is present, the parent is expected to provide a value other than `undefined`, else a runtime error is thrown. This prevents hard-to-reason-about situations where it's unclear which value should apply.
