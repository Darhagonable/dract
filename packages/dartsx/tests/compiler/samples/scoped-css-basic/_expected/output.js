import $ from 'dartsx/internal/client';

function Card() {
    $.style("bi0d1w", "h2[data-scope~=\"bi0d1w\"] { color: red; }\np[data-scope~=\"bi0d1w\"] { font-size: 14px; }\n");

    return $.jsx("div", { "data-scope": "bi0d1w", children: [$.jsx("h2", { "data-scope": "bi0d1w", children: ["Title"] }), $.jsx("p", { "data-scope": "bi0d1w", children: ["Content"] })] });
}
