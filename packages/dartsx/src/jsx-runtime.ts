import { Fragment, jsx as createJsx } from './runtime/internal/client';
import type { SvelteHTMLElements } from './elements';
import type { DarTsxNode } from './runtime/external/types';

type Key = string | number | bigint;

type DarTsxComponentLike = (...args: any[]) => DarTsxNode;

type DarTsxElementType = Extract<keyof SvelteHTMLElements, string> | DarTsxComponentLike;

export { Fragment };

export function jsx(type: DarTsxElementType, props?: Record<string, unknown> | null, key?: Key): Node {
	if (key === undefined) {
		return createJsx(type, props);
	}

	return createJsx(type, { ...props, key });
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export namespace JSX {
	export type Element = Node;
	export type ElementType = DarTsxElementType;
	export interface ElementChildrenAttribute {
		children: {};
	}
	export interface IntrinsicAttributes {
		key?: Key;
	}
	export interface IntrinsicElements extends SvelteHTMLElements { }
	export type LibraryManagedAttributes<C, P> = P;
}

declare global {
	namespace JSX {
		type Element = Node;
		type ElementType = DarTsxElementType;
		interface ElementChildrenAttribute {
			children: {};
		}
		interface IntrinsicAttributes {
			key?: Key;
		}
		interface IntrinsicElements extends SvelteHTMLElements { }
		type LibraryManagedAttributes<C, P> = P;
	}
}
