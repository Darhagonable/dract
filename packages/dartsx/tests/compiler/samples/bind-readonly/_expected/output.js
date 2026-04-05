import $ from 'dartsx/internal/client';

function Layout() {
    let width = $.state(0);

    return $.jsx("div", { "bind:clientWidth": [null, (v) => $.set(width, v)], children: ["content"] });
}
