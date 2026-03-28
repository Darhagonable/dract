import { setCurrentComponent, type ComponentContext } from '../internal/client';

/**
 * Mount a component into a target element.
 * Creates a comment anchor inside the target, sets up a component context,
 * and flushes onMount callbacks after the component initializes.
 */
export function mount(component: (anchor: Node) => void, target: Element): void {
    const anchor = document.createComment('');
    target.appendChild(anchor);

    const ctx: ComponentContext = {
        onMountCallbacks: [],
        onDestroyCallbacks: [],
        cleanupCallbacks: [],
    };

    const prev = setCurrentComponent(ctx);
    component(anchor);
    setCurrentComponent(prev);

    // Flush onMount callbacks after the component is in the DOM
    for (const cb of ctx.onMountCallbacks) {
        cb();
    }
}