import $ from "dartsx/internal/client";

function Parent() {
	$.style("i1ufxg", "div[data-scope~=\"i1ufxg\"] { padding: 16px; }\n.wrapper[data-scope~=\"i1ufxg\"] .child-title { color: red; }\n[data-scope~=\"i1ufxg\"] .inner { font-size: 12px; }\n");

	return $.jsx("div", {
		"data-scope": "i1ufxg",
		children: [$.jsx("p", { "data-scope": "i1ufxg", children: ["Styled"] })]
	});
}