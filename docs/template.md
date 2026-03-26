## Components

Fundamentally components are just functions but instead of the function keyword it's component and instead of return its render. also that props are the params where the names of the params are the prop names and the order doesnt matter.

## Events

Listening to DOM events is possible by adding attributes to the element that start with `on`. For example, to listen to the `click` event, add the `onclick` attribute to a button:

```svelte
<button onclick={() => console.log('clicked')}>click me</button>
```

Event attributes are case sensitive. `onclick` listens to the `click` event, `onClick` listens to the `Click` event, which is different. This ensures you can listen to custom events that have uppercase characters in them.

Because events are just attributes, the same rules as for attributes apply:

- you can use the shorthand form: `<button {onclick}>click me</button>`
- you can spread them: `<button {...thisSpreadContainsEventAttributes}>click me</button>`

Timing-wise, event attributes always fire after events from bindings (e.g. `oninput` always fires after an update to `bind:value`). Under the hood, some event handlers are attached directly with `addEventListener`, while others are _delegated_.

When using `ontouchstart` and `ontouchmove` event attributes, the handlers are [passive](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#using_passive_listeners) for better performance. This greatly improves responsiveness by allowing the browser to scroll the document immediately, rather than waiting to see if the event handler calls `event.preventDefault()`.

In the very rare cases that you need to prevent these event defaults, you should use [`on`](svelte-events#on) instead (for example inside an action).

### Event delegation

To reduce memory footprint and increase performance, Svelte uses a technique called event delegation. This means that for certain events — see the list below — a single event listener at the application root takes responsibility for running any handlers on the event's path.

There are a few gotchas to be aware of:

- when you manually dispatch an event with a delegated listener, make sure to set the `{ bubbles: true }` option or it won't reach the application root
- when using `addEventListener` directly, avoid calling `stopPropagation` or the event won't reach the application root and handlers won't be invoked. Similarly, handlers added manually inside the application root will run _before_ handlers added declaratively deeper in the DOM (with e.g. `onclick={...}`), in both capturing and bubbling phases. For these reasons it's better to use the `on` function imported from `svelte/events` rather than `addEventListener`, as it will ensure that order is preserved and `stopPropagation` is handled correctly.

The following event handlers are delegated:

- `beforeinput`
- `click`
- `change`
- `dblclick`
- `contextmenu`
- `focusin`
- `focusout`
- `input`
- `keydown`
- `keyup`
- `mousedown`
- `mousemove`
- `mouseout`
- `mouseover`
- `mouseup`
- `pointerdown`
- `pointermove`
- `pointerout`
- `pointerover`
- `pointerup`
- `touchend`
- `touchmove`
- `touchstart`

## Text expressions

A JavaScript expression can be included as text by surrounding it with curly braces.

```svelte
{expression}
```

Expressions that are `null` or `undefined` will be omitted; all others are [coerced to strings](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String#string_coercion).

Curly braces can be included in a Svelte template by using their [HTML entity](https://developer.mozilla.org/docs/Glossary/Entity) strings: `&lbrace;`, `&lcub;`, or `&#123;` for `{` and `&rbrace;`, `&rcub;`, or `&#125;` for `}`.

If you're using a regular expression (`RegExp`) [literal notation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp#literal_notation_and_constructor), you'll need to wrap it in parentheses.