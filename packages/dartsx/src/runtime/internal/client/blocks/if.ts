import { effect } from '../reactivity/effect';

export function if_block(
    condFn: () => any,
    trueFn: () => any,
    falseFn?: () => any,
): Node {
    const start = document.createComment('');
    const end = document.createComment('');
    const frag = document.createDocumentFragment();
    frag.appendChild(start);
    frag.appendChild(end);

    let currentBranch: boolean | null = null;

    effect(() => {
        const cond = !!condFn();
        if (cond === currentBranch) return;
        currentBranch = cond;

        while (start.nextSibling !== end) {
            start.nextSibling!.remove();
        }

        const result = cond ? trueFn() : (falseFn ? falseFn() : null);
        if (result instanceof Node) {
            end.parentNode!.insertBefore(result, end);
        } else if (result != null && result !== false && result !== true) {
            end.parentNode!.insertBefore(document.createTextNode(String(result)), end);
        }
    });

    return frag;
}
