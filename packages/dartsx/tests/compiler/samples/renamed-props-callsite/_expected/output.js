import $ from 'dartsx/internal/client';

function Greeting($$props) {
    const firstName = $.prop($$props, 'first-name');

    return $.jsx("h1", { children: [() => $.get(firstName)] });
}

function App() {
    return $.jsx(Greeting, { "first-name": () => "Alice" });
}
