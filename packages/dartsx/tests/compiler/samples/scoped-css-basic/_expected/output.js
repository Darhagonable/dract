import $ from 'dartsx/internal/client';

function Card() {
    $.style("bi0d1w", "h2[data-dartsx-bi0d1w] { color: red; }\np[data-dartsx-bi0d1w] { font-size: 14px; }\n");

    return $.jsx("div", { "data-dartsx-bi0d1w": "", children: [$.jsx("h2", { "data-dartsx-bi0d1w": "", children: ["Title"] }), $.jsx("p", { "data-dartsx-bi0d1w": "", children: ["Content"] })] });
}
