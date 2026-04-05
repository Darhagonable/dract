import $ from 'dartsx/internal/client';

export default function Greeting($$props) {
    const name = $.prop($$props, 'name', "World");

    return $.jsx("h1", { children: ["Hello, ", () => $.get(name)] });
}
