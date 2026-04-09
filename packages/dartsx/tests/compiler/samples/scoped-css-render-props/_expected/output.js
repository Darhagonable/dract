import $ from 'dartsx/internal/client';

function Dashboard() {
    $.style("19lm7ya", "th[data-dartsx-19lm7ya] { background: #333; }\ntd[data-dartsx-19lm7ya] { padding: 8px; }\n");

    return $.jsx(DataTable, { get header() { return <th data-dartsx-19lm7ya="">Name</th>; }, get renderRow() { return (row) => <tr data-dartsx-19lm7ya=""><td data-dartsx-19lm7ya="">{row.name}</td></tr>; } });
}
