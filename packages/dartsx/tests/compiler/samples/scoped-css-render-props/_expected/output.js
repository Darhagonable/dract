import $ from 'dartsx/internal/client';

function Dashboard() {
    $.style("19lm7ya", "th[data-scope~=\"19lm7ya\"] { background: #333; }\ntd[data-scope~=\"19lm7ya\"] { padding: 8px; }\n");

    return $.jsx(DataTable, { header: $.jsx("th", { "data-scope": "19lm7ya", children: ["Name"] }), renderRow: (row) => $.jsx("tr", { "data-scope": "19lm7ya", children: [$.jsx("td", { "data-scope": "19lm7ya", children: [row.name] })] }) });
}
