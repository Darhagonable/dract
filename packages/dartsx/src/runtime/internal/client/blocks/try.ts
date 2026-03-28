/**
 * Reactive try block (error boundary).
 * Renders the try branch; if it throws, renders the catch branch.
 * Optionally supports a pending branch for async components (suspense).
 * Content is inserted before the anchor comment node.
 */
export function try_block(
    anchor: Node,
    tryFn: (anchor: Node) => void,
    catchFn?: (anchor: Node, error: unknown) => void,
    pendingFn?: (anchor: Node) => void,
): void {
    const startMarker = document.createComment('');
    anchor.parentNode!.insertBefore(startMarker, anchor);

    function clearContent(): void {
        while (startMarker.nextSibling !== anchor) {
            startMarker.nextSibling!.remove();
        }
    }

    try {
        tryFn(anchor);
    } catch (error) {
        clearContent();
        if (catchFn) {
            catchFn(anchor, error);
        }
    }
}
