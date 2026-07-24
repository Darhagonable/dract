import type { DarTsxHTMLElements } from './elements';
import type { DarTsxNode } from './runtime/external/types';

export namespace JSX {
	export type Element = DarTsxNode;
	export type ElementType = keyof DarTsxHTMLElements | ((...args: any[]) => DarTsxNode);
	export interface ElementChildrenAttribute {
		children: {};
	}
	export interface IntrinsicAttributes {
		key?: string | number | bigint;
	}
	export type IntrinsicElements = { [K in keyof DarTsxHTMLElements]: DarTsxHTMLElements[K] };
}
