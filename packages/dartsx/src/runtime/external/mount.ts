import { setCurrentComponent, type ComponentContext } from '../internal/client';
import type { Component } from './types';

export interface MountResult {
    /** Unmount the component: runs onDestroy/cleanup callbacks and removes DOM. */
    unmount(): void;
}

/**
 * Mount a component into a target element.
 * Components return DOM nodes; mount appends them to the target.
 * Returns a handle with an `unmount()` method.
 */
export function mount<P extends Record<string, unknown>>(component: Component<P>, target: Element, props?: P): MountResult {
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

    // Flush onMount callbacks after the component is in the DOM.
    // Re-set component context so onCleanup inside onMount registers correctly.
    const prev2 = setCurrentComponent(ctx);
    for (const cb of ctx.onMountCallbacks) {
        cb();
    }
    setCurrentComponent(prev2);

    return {
        unmount() {
            for (const cb of ctx.cleanupCallbacks) cb();
            for (const cb of ctx.onDestroyCallbacks) cb();
            if (dom instanceof Node && dom.parentNode) {
                dom.parentNode.removeChild(dom);
            }
        },
    };
}