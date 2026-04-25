import $ from "dartsx/internal/client";
function Form() {
	let value = $.state("hello");
	return $.jsx("input", { "bind:value": [() => $.get(value), (v) => $.set(value, v.toLowerCase())] });
}
