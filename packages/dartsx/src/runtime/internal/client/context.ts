// ── Component context (for lifecycle hooks + context) ──────────────

export interface ComponentContext {
	onMountCallbacks: (() => void | (() => void))[];
	onDestroyCallbacks: (() => void)[];
	cleanupCallbacks: (() => void)[];
	parent: ComponentContext | null;
	contexts: Map<symbol, any>;
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
