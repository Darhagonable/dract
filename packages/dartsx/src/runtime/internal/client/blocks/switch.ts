import { effect } from '../reactivity/effect';

/**
 * Case definition for a switch block.
 * Each case has an array of match values and a render function.
 * A null values array means this is the default case.
 */
export interface SwitchCase {
    /** Match values for this case, or null for the default case */
    values: any[] | null;
    /** Render function for this case branch */
    fn: (anchor: Node) => void;
}

/**
 * Reactive switch block. Evaluates a discriminant and renders the matching case.
 * Supports fall-through via grouped case values and a default case.
 * Content is inserted before the anchor comment node.
 */
export function switch_block(
    anchor: Node,
    discriminantFn: () => any,
    cases: SwitchCase[],
): void {
    const startMarker = document.createComment('');
    anchor.parentNode!.insertBefore(startMarker, anchor);

    let currentCaseIndex: number = -1;

    effect(() => {
        const value = discriminantFn();

        // Find the matching case
        let matchIndex = -1;
        for (let i = 0; i < cases.length; i++) {
            const c = cases[i];
            if (c.values === null) {
                // Default case — use as fallback
                if (matchIndex === -1) matchIndex = i;
            } else if (c.values.includes(value)) {
                matchIndex = i;
                break;
            }
        }

        if (matchIndex === currentCaseIndex) return;
        currentCaseIndex = matchIndex;

        // Remove old content between markers
        while (startMarker.nextSibling !== anchor) {
            startMarker.nextSibling!.remove();
        }

        // Render matched case
        if (matchIndex !== -1) {
            cases[matchIndex].fn(anchor);
        }
    });
}
