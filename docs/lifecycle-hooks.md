# Lifecycle hooks

In this framework, the component lifecycle consists of only two parts: Its creation and its destruction. Everything in-between — when certain state is updated — is not related to the component as a whole; only the parts that need to react to the state change are notified. This is because under the hood the smallest unit of change is actually not a component, it's the (render) effects that the component sets up upon component initialization. Consequently, there's no such thing as a "before update"/"after update" hook.

## `onMount`

The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM. It must be called during the component's initialisation (but doesn't need to live _inside_ the component; it can be called from an external module).

```tsx
import { onMount } from 'this-framework';

component App() {
  onMount(() => {
    console.log('the component has mounted');
  });
}
```

Use `onCleanup` to register cleanup that runs when the component unmounts:

```tsx
import { onMount, onCleanup } from 'this-framework';

component App() {
  onMount(() => {
		const interval = setInterval(() => {
			console.log('beep');
		}, 1000);

		onCleanup(() => clearInterval(interval));
	});
}
```

> [!NOTE] This behaviour will only work when the function passed to `onMount` is _synchronous_. `async` functions always return a `Promise`.

## `onDestroy`

Schedules a callback to run immediately before the component is unmounted.

```tsx
import { onDestroy } from 'this-framework';

component App() {
  onDestroy(() => {
		console.log('the component is being destroyed');
	});
}
```

## `tick`

While there's no "after update" hook, you can use `tick` to ensure that the UI is updated before continuing. `tick` returns a promise that resolves once any pending state changes have been applied, or in the next microtask if there are none.

```tsx
import { effect, tick } from 'this-framework'';

effect(count, () => {
  console.log('the component is about to update');
  tick().then(() => {
      console.log('the component just updated');
  });
});
```
