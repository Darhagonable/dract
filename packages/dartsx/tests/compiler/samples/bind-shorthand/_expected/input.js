import $ from "dartsx/internal/client";

function X() {
	let value = $.state("");

	return $.jsx("input", { "bind:value": [() => $.get(value), (v) => $.set(value, v)] });
}