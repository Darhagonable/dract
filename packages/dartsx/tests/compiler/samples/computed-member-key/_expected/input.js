import $ from "dartsx/internal/client";

function X() {
	let idx = $.state(0);

	return $.jsx("p", { children: [() => items[$.get(idx)]] });
}