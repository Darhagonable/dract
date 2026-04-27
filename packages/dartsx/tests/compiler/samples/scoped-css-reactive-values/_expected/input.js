import $ from "dartsx/internal/client";

function Button($$props) {
	$.style("1ei60oi", "button[data-scope~=\"1ei60oi\"] {\n  color: var(--color);\n  font-size: var(--size);\n  padding: var(--size-n83f) var(--size);\n}\n");

	const color = $.prop($$props, "color");
	let size = $.state(16);

	return $.jsx("button", {
		"data-scope": "1ei60oi",
		style: () => ({
			"--color": $.get(color),
			"--size": $.get(size) + "px",
			"--size-n83f": $.get(size) / 2 + "px"
		}),
		children: ["Click me"]
	});
}