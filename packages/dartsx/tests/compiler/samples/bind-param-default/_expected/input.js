import $ from "dartsx/internal/client";

function Keypad($$props) {
	let value = $.prop.bind($$props, "value", "fallback");

	return $.jsx("p", { children: [() => $.get(value)] });
}