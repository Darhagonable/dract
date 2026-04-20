import $ from 'dartsx/internal/client';

function Parent() {
    $.style("bs4yz2", "div[data-scope~=\"bs4yz2\"] { padding: 16px; }\n.wrapper[data-scope~=\"bs4yz2\"] .child-title { color: red; }\n[data-scope~=\"bs4yz2\"] .inner { font-size: 12px; }\n");

    return $.jsx("div", { "data-scope": "bs4yz2", children: [$.jsx("p", { "data-scope": "bs4yz2", children: ["Styled"] })] });
}
