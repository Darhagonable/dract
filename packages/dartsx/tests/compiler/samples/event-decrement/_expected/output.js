import $ from 'dartsx/internal/client';

function X() {
    let count = $.state(10);

    return $.jsx("button", { onclick: () => $.set(count, $.get(count) - 1), children: ["go"] });
}
