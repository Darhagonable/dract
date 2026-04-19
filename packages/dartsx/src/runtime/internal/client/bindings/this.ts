export function bindThis(element: Element, set: (element: Element | undefined) => void) {
	set(element);
}
