import $ from "dartsx/internal/client";

function Fragment() {
	$.style("zb67ce", "h1[data-scope~=\"zb67ce\"] { font-size: 2em; }\np[data-scope~=\"zb67ce\"] { color: gray; }\n");

	return $.jsx($.Fragment, {
		children: [
			$.jsx("h1", { "data-scope": "zb67ce", children: ["Title"] }),
			$.jsx("p", { "data-scope": "zb67ce", children: ["Content"] })
		]
	});
}