import $ from 'dartsx/internal/client';

function Responsive() {
    $.style("1gxypag", "div[data-scope~=\"1gxypag\"] { padding: 16px; }\n@media (max-width: 768px) {\n  p[data-scope~=\"1gxypag\"] { font-size: 12px; }\n}\n");

    return $.jsx("div", { "data-scope": "1gxypag", children: [$.jsx("p", { "data-scope": "1gxypag", children: ["Content"] })] });
}
