// ── Context API ────────────────────────────────────────────────────

import { getCurrentComponent } from '../internal/client/context';

type ContextValue<T> = T extends (...args: any[]) => infer R ? R : T;
type ContextArgs<T> = T extends (...args: infer A) => any ? A : [];

export interface Context<T> {
	(): ContextValue<T>;
	/** @internal */ _id: symbol;
	/** @internal */ _factory: (...args: ContextArgs<T>) => ContextValue<T>;
}

/**
 * Create a context with a factory function.
 * The factory runs once when `provide()` is called, and the returned
 * value is what consumers receive when calling the context.
 *
 * The factory can accept arguments passed via `provide(ctx, ...args)`.
 * Calling the context outside a provider's tree throws an error.
 */
export function createContext<T>(factory: () => T): Context<T>;
export function createContext<T extends (...args: any[]) => any>(factory: T): Context<T>;
export function createContext<T>(factory: (...args: any[]) => any): Context<T> {
	const id = Symbol();

	const ctx: Context<T> = () => {
		let comp = getCurrentComponent();
		while (comp) {
			if (comp.contexts.has(id)) return comp.contexts.get(id);
			comp = comp.parent;
		}
		throw new Error('Context was accessed outside of a provided scope. Call provide(context) in a parent component first.');
	};

	ctx._id = id;
	ctx._factory = factory;

	return ctx;
}

/**
 * Provide a context in the current component scope.
 * Runs the context's factory function and stores the result
 * on the current component's context map, scoped to its subtree.
 */
export function provide<T>(ctx: Context<T>, ...args: ContextArgs<T>) {
	const comp = getCurrentComponent();
	if (!comp) {
		throw new Error('provide() must be called during component initialization.');
	}
	const value = ctx._factory(...args);
	comp.contexts.set(ctx._id, value);
}
