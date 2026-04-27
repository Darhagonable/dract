import $ from "dartsx/internal/client";

function Widget() {
	$.style("1tdvx5q", "p[data-scope~=\"1tdvx5q\"] { color: red; }\nbody { margin: 0; }\ndiv:where([data-scope~=\"1tdvx5q\"]) > p[data-scope~=\"1tdvx5q\"] { font-size: 14px; }\nh1[data-scope~=\"1tdvx5q\"], h2[data-scope~=\"1tdvx5q\"] { font-weight: bold; }\nul:where([data-scope~=\"1tdvx5q\"]) li:first-child[data-scope~=\"1tdvx5q\"] { color: blue; }\np[data-scope~=\"1tdvx5q\"]::before { content: '> '; }\n");

	return $.jsx("div", {
		"data-scope": "1tdvx5q",
		children: [
			$.jsx("p", { "data-scope": "1tdvx5q", children: ["Content"] })
		]
	});
}