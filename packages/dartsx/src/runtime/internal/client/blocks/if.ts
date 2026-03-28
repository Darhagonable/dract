import { effect } from '../reactivity/effect';

/**
 * Reactive if block. Renders one branch at a time; swaps when condition changes.
 * Content is inserted before the anchor comment node.
 */
export function if_block(
    anchor: Node,
    condFn: () => boolean,
    trueFn: (anchor: Node) => void,
    falseFn?: (anchor: Node) => void,
): void {
    const startMarker = document.createComment('');
    anchor.parentNode!.insertBefore(startMarker, anchor);

    let currentBranch: boolean | null = null;

    effect(() => {
        const cond = !!condFn();
        if (cond === currentBranch) return;
        currentBranch = cond;

        // Remove old content between markers
        while (startMarker.nextSibling !== anchor) {
            startMarker.nextSibling!.remove();
        }

        // Render new branch — content inserts before anchor
        if (cond) {
            trueFn(anchor);
        } else if (falseFn) {
            falseFn(anchor);
        }
    });
}
