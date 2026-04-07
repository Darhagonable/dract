import $ from 'dartsx/internal/client';

function App() {
    let items = $.state(["a", "b"]);
    return $.jsx("ul", { children: [$.for(() => $.get(items), (item, i) => $.jsx("li", { children: [i, ": ", item] }))] });
}

