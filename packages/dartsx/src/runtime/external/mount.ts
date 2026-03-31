import { setCurrentComponent, type ComponentContext } from '../internal/client';

/**
 * Mount a component into a target element.
 * Components return DOM nodes; mount appends them to the target.
 */
export function mount(component: (props?: Record<string, unknown>) => Node, target: Element, props?: Record<string, unknown>): void {
    const ctx: ComponentContext = {
        onMountCallbacks: [],
        onDestroyCallbacks: [],
        cleanupCallbacks: [],
    };

    const prev = setCurrentComponent(ctx);
    const dom = component(props || {});
    setCurrentComponent(prev);

    if (dom instanceof Node) {
        target.appendChild(dom);
    }

    // Flush onMount callbacks after the component is in the DOM
    for (const cb of ctx.onMountCallbacks) {
        cb();
    }
}