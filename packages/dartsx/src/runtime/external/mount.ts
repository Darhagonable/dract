import { setCurrentComponent, type ComponentContext } from '../internal/client';
import type { Component } from './types';

/**
 * Mount a component into a target element.
 * Components return DOM nodes; mount appends them to the target.
 */
export function mount<P extends Record<string, unknown>>(component: Component<P>, target: Element, props?: P): void {
    const ctx: ComponentContext = {
        onMountCallbacks: [],
        onDestroyCallbacks: [],
        cleanupCallbacks: [],
    };

    const prev = setCurrentComponent(ctx);
    const dom = component(props ?? {} as P);
    setCurrentComponent(prev);

    if (dom instanceof Node) {
        target.appendChild(dom);
    }

    // Flush onMount callbacks after the component is in the DOM
    for (const cb of ctx.onMountCallbacks) {
        cb();
    }
}