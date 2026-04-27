import $ from "dartsx/internal/client";

function StyledComponent() {
	$.style("e1ci41", "p[data-scope~=\"e1ci41\"] { color: green; }\n");
	$.style("e1ci42", "p[data-scope~=\"e1ci42\"] { color: red; }\n");

	return $.jsx("div", {
		"data-scope": "e1ci42",
		children: [
			$.jsx("p", { "data-scope": "e1ci42", children: ["Outside"] }),
			$.jsx("div", {
				"data-scope": "e1ci42 e1ci41",
				children: [
					$.jsx("p", { "data-scope": "e1ci42 e1ci41", children: ["Inside"] })
				]
			})
		]
	});
}