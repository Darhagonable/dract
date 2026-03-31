// ── Component context (for lifecycle hooks) ────────────────────────

export interface ComponentContext {
    onMountCallbacks: (() => void | (() => void))[];
    onDestroyCallbacks: (() => void)[];
    cleanupCallbacks: (() => void)[];
}

let currentComponent: ComponentContext | null = null;

export function getCurrentComponent(): ComponentContext | null {
    return currentComponent;
}

export function setCurrentComponent(ctx: ComponentContext | null): ComponentContext | null {
    const prev = currentComponent;
    currentComponent = ctx;
    return prev;
}
