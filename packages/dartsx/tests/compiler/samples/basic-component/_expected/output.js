import $ from 'dartsx/internal/client';

function HelloWorld() {
    let name = $.state("world");
    let count = $.state(0);
    const doubled = $.derived(() => $.get(count) * 2);

    return $.jsx($.Fragment, { children: [$.jsx("h1", { children: ["Hello ", () => $.get(name)] }), $.jsx("input", { "bind:value": [() => $.get(name), (v) => $.set(name, v)] }), $.jsx("button", { onclick: () => $.set(count, $.get(count) + 1), children: ["clicks: ", () => $.get(count)] }), $.jsx("p", { children: ["doubled: ", () => $.get(doubled)] })] });
}
