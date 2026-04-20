import $ from 'dartsx/internal/client';

function Wrapper() {
    let content = $.state(null);
    const resolved = $.derived(() => $.get(content) ?? 'fallback');
    return () => $.get(resolved);
}
