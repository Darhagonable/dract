import type { Component } from '../../src/runtime/external/types';
import type { MountResult } from '../../src/runtime/external/mount';

export {};

declare global {
	function mountComponent(component: Component): MountResult;

	var container: HTMLDivElement;

	type TagNameMap = HTMLElementTagNameMap & SVGElementTagNameMap;

	interface ParentNode {
		querySelector<K extends keyof TagNameMap>(selectors: K): TagNameMap[K];
		querySelector(selectors: string): HTMLElement;
		querySelectorAll<K extends keyof TagNameMap>(selectors: K): NodeListOf<TagNameMap[K]>;
		querySelectorAll(selectors: string): NodeListOf<Element>;
	}
}
