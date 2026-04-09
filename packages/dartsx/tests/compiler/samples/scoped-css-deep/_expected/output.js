import $ from 'dartsx/internal/client';

function Parent() {
    $.style("i1ufxg", "div[data-dartsx-i1ufxg] { padding: 16px; }\n.wrapper[data-dartsx-i1ufxg] .child-title { color: red; }\n[data-dartsx-i1ufxg] .inner { font-size: 12px; }\n");

    return $.jsx("div", { "data-dartsx-i1ufxg": "", children: [$.jsx("p", { "data-dartsx-i1ufxg": "", children: ["Styled"] })] });
}
