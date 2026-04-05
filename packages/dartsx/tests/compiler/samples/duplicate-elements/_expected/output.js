import $ from 'dartsx/internal/client';

function X() {
    let a = $.state("one");
    let b = $.state("two");

    return $.jsx($.Fragment, { children: [$.jsx("p", { children: [() => $.get(a)] }), $.jsx("p", { children: [() => $.get(b)] })] });
}
