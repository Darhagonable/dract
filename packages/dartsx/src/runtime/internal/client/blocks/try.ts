export function try_block(
    tryFn: () => unknown,
    catchFn?: (error: unknown) => unknown,
    pendingFn?: () => unknown,
): Node {
    const start = document.createComment('');
    const end = document.createComment('');
    const frag = document.createDocumentFragment();
    frag.appendChild(start);
    frag.appendChild(end);

    function clearContent(): void {
        while (start.nextSibling !== end) {
            start.nextSibling!.remove();
        }
    }

    function insertResult(result: unknown): void {
        if (result instanceof Node) {
            end.parentNode!.insertBefore(result, end);
        } else if (result != null && result !== false && result !== true) {
            end.parentNode!.insertBefore(document.createTextNode(String(result)), end);
        }
    }

    try {
        const result = Promise.resolve(tryFn());

        if (pendingFn) {
            insertResult(pendingFn());
        }

        result.then(
            (resolved) => {
                clearContent();
                insertResult(resolved);
            },
            (error) => {
                clearContent();
                if (catchFn) {
                    insertResult(catchFn(error));
                }
            },
        );
    } catch (error) {
        if (catchFn) {
            insertResult(catchFn(error));
        }
    }

    return frag;
}
