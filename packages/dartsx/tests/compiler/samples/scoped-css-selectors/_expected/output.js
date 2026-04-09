import $ from 'dartsx/internal/client';

function Widget() {
    $.style("18mt1zy", "p[data-dartsx-18mt1zy] { color: red; }\nbody { margin: 0; }\ndiv:where([data-dartsx-18mt1zy]) > p[data-dartsx-18mt1zy] { font-size: 14px; }\nh1[data-dartsx-18mt1zy], h2[data-dartsx-18mt1zy] { font-weight: bold; }\nul:where([data-dartsx-18mt1zy]) li:first-child[data-dartsx-18mt1zy] { color: blue; }\np[data-dartsx-18mt1zy]::before { content: '> '; }\n");

    return $.jsx("div", { "data-dartsx-18mt1zy": "", children: [$.jsx("p", { "data-dartsx-18mt1zy": "", children: ["Content"] })] });
}
