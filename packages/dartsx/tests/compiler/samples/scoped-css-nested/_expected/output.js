import $ from 'dartsx/internal/client';

function StyledComponent() {
    $.style("1nyezsy", "p[data-scope~=\"1nyezsy\"] { color: green; }\n");
    $.style("1nyezsz", "p[data-scope~=\"1nyezsz\"] { color: red; }\n");

    return $.jsx("div", { "data-scope": "1nyezsz", children: [$.jsx("p", { "data-scope": "1nyezsz", children: ["Outside"] }), $.jsx("div", { "data-scope": "1nyezsz 1nyezsy", children: [$.jsx("p", { "data-scope": "1nyezsz 1nyezsy", children: ["Inside"] })] })] });
}
