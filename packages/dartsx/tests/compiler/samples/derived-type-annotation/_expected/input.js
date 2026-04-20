import $ from 'dartsx/internal/client';

function App() {
    let count = $.state(0);
    const doubled = $.derived(() => $.get(count) * 2);
    return $.jsx("div", { children: [() => $.get(doubled)] });
}
