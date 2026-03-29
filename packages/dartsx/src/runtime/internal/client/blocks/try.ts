export function try_block(
    tryFn: () => any,
    catchFn?: (error: unknown) => any,
    pendingFn?: () => any,
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

    function insertResult(result: any): void {
        if (result instanceof Node) {
            end.parentNode!.insertBefore(result, end);
        } else if (result != null && result !== false && result !== true) {
            end.parentNode!.insertBefore(document.createTextNode(String(result)), end);
        }
    }

    try {
        const result = tryFn();

        // Async result — show pending, then resolve or catch
        if (result != null && typeof result === 'object' && typeof result.then === 'function') {
            if (pendingFn) {
                insertResult(pendingFn());
            }

            (result as Promise<any>).then(
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
        } else {
            // Synchronous result
            insertResult(result);
        }
    } catch (error) {
        if (catchFn) {
            insertResult(catchFn(error));
        }
    }

    return frag;
}
