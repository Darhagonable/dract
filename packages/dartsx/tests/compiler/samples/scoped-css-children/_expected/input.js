import $ from "dartsx/internal/client";

function Parent($$props) {
	$.style("i1ufxg", "p[data-scope~=\"i1ufxg\"] { color: red; }\n");

	const children = $.prop($$props, "children");

	return $.jsx("div", {
		"data-scope": "i1ufxg",
		children: [
			$.jsx("p", { "data-scope": "i1ufxg", children: ["Parent text"] }),
			" ",
			() => $.get(children)
		]
	});
}