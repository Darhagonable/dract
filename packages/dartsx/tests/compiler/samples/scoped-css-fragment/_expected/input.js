import $ from "dartsx/internal/client";
function Fragment() {
	$.style("9hhrhq", "h1[data-scope~=\"9hhrhq\"] { font-size: 2em; }\np[data-scope~=\"9hhrhq\"] { color: gray; }\n");
	return $.jsx($.Fragment, { children: [$.jsx("h1", {
		"data-scope": "9hhrhq",
		children: ["Title"]
	}), $.jsx("p", {
		"data-scope": "9hhrhq",
		children: ["Content"]
	})] });
}
