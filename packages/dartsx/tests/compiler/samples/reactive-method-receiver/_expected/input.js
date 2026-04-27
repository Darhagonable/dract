import $ from "dartsx/internal/client";

function X() {
	let count = $.state(0);

	return $.jsx("p", { children: [() => $.get(count).toString()] });
}