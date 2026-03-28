import { effect } from '../reactivity/effect';

/**
 * Reactive for block. Re-renders list items when the collection changes.
 * Uses optional key function for efficient reconciliation.
 */
export function for_block(
    anchor: Node,
    collFn: () => any[],
    bodyFn: (anchor: Node, item: any, index: number) => void,
    keyFn?: (item: any) => any,
): void {
    const startMarker = document.createComment('');
    anchor.parentNode!.insertBefore(startMarker, anchor);

    let currentItems: any[] = [];

    effect(() => {
        const items = collFn() || [];

        // Remove old content
        while (startMarker.nextSibling !== anchor) {
            startMarker.nextSibling!.remove();
        }

        // Render each item
        for (let i = 0; i < items.length; i++) {
            bodyFn(anchor, items[i], i);
        }

        currentItems = [...items];
    });
}
