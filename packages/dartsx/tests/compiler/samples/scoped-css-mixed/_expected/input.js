import $ from 'dartsx/internal/client';

function Mixed() {
    $.style("1pkp990", "div[data-scope~=\"1pkp990\"] { padding: 16px; }\n");
    $.style("1pkp991", "body { margin: 0; }");

    return $.jsx("div", { "data-scope": "1pkp990", children: [$.jsx("p", { "data-scope": "1pkp990", children: ["Styled"] })] });
}
