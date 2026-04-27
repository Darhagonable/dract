import $ from "dartsx/internal/client";

function List() {
	$.style("feiky0", "li[data-scope~=\"feiky0\"] { padding: 4px; }\n");

	let items = $.state(["a", "b", "c"]);

	return $.jsx("ul", {
		"data-scope": "feiky0",
		children: [
			$.for(() => $.get(items), (item) => $.jsx("li", { "data-scope": "feiky0", children: [item] }))
		]
	});
}