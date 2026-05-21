import $ from "dartsx/internal/client";

function Mixed() {
	$.style("2b58up", "div[data-scope~=\"2b58up\"] { padding: 16px; }\n");
	$.style("2b58uq", "body { margin: 0; }");

	return $.jsx("div", {
		"data-scope": "2b58up",
		children: [$.jsx("p", { "data-scope": "2b58up", children: ["Styled"] })]
	});
}