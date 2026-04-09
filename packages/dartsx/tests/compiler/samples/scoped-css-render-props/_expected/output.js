import $ from 'dartsx/internal/client';

function Dashboard() {
    $.style("19lm7ya", "th[data-scope~=\"19lm7ya\"] { background: #333; }\ntd[data-scope~=\"19lm7ya\"] { padding: 8px; }\n");

    return $.jsx(DataTable, { get header() { return <th data-scope="19lm7ya">Name</th>; }, get renderRow() { return (row) => <tr data-scope="19lm7ya"><td data-scope="19lm7ya">{row.name}</td></tr>; } });
}
