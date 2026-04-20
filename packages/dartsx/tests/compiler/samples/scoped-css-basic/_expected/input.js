import $ from 'dartsx/internal/client';

function Card() {
    $.style("rq5ite", "h2[data-scope~=\"rq5ite\"] { color: red; }\np[data-scope~=\"rq5ite\"] { font-size: 14px; }\n");

    return $.jsx("div", { "data-scope": "rq5ite", children: [$.jsx("h2", { "data-scope": "rq5ite", children: ["Title"] }), $.jsx("p", { "data-scope": "rq5ite", children: ["Content"] })] });
}
