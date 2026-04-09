import $ from 'dartsx/internal/client';

function StyledComponent() {
    $.style("1nyezsy", "p[data-dartsx-1nyezsy] { color: green; }\n");
    $.style("1nyezsz", "p[data-dartsx-1nyezsz] { color: red; }\n");

    return $.jsx("div", { "data-dartsx-1nyezsz": "", children: [$.jsx("p", { "data-dartsx-1nyezsz": "", children: ["Outside"] }), $.jsx("div", { "data-dartsx-1nyezsz": "", "data-dartsx-1nyezsy": "", children: [$.jsx("p", { "data-dartsx-1nyezsz": "", "data-dartsx-1nyezsy": "", children: ["Inside"] })] })] });
}
