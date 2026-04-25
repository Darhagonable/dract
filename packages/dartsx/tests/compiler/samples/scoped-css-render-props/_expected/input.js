import $ from "dartsx/internal/client";
function Dashboard() {
	$.style("ykuwen", "th[data-scope~=\"ykuwen\"] { background: #333; }\ntd[data-scope~=\"ykuwen\"] { padding: 8px; }\n");
	return $.jsx(DataTable, {
		header: $.jsx("th", {
			"data-scope": "ykuwen",
			children: ["Name"]
		}),
		renderRow: (row) => $.jsx("tr", {
			"data-scope": "ykuwen",
			children: [$.jsx("td", {
				"data-scope": "ykuwen",
				children: [row.name]
			})]
		})
	});
}
