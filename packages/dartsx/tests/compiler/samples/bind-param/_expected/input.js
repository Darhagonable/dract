import $ from "dartsx/internal/client";
function Keypad($$props) {
	const readonlyProp = $.prop($$props, "readonlyProp");
	let value = $.prop.bind($$props, "value");
	return $.jsx("p", { children: [() => $.get(value)] });
}
