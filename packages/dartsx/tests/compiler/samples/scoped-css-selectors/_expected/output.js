import $ from 'dartsx/internal/client';

function Widget() {
    $.style("18mt1zy", "p[data-scope~=\"18mt1zy\"] { color: red; }\nbody { margin: 0; }\ndiv:where([data-scope~=\"18mt1zy\"]) > p[data-scope~=\"18mt1zy\"] { font-size: 14px; }\nh1[data-scope~=\"18mt1zy\"], h2[data-scope~=\"18mt1zy\"] { font-weight: bold; }\nul:where([data-scope~=\"18mt1zy\"]) li:first-child[data-scope~=\"18mt1zy\"] { color: blue; }\np[data-scope~=\"18mt1zy\"]::before { content: '> '; }\n");

    return $.jsx("div", { "data-scope": "18mt1zy", children: [$.jsx("p", { "data-scope": "18mt1zy", children: ["Content"] })] });
}
