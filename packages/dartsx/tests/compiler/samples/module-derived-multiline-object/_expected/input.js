import $ from "dartsx/internal/client";
let x = $.state(1);
const info = $.derived(() => ({
	value: $.get(x),
	label: "count"
}));
function Display() {
	return $.jsx("span", { children: [() => info.value] });
}
