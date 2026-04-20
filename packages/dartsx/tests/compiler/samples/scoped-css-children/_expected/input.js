import $ from 'dartsx/internal/client';

function Parent($$props) {
    $.style("1x7gduh", "p[data-scope~=\"1x7gduh\"] { color: red; }\n");

    const children = $.prop($$props, 'children');

    return $.jsx("div", { "data-scope": "1x7gduh", children: [$.jsx("p", { "data-scope": "1x7gduh", children: ["Parent text"] }), " ", () => $.get(children)] });
}
