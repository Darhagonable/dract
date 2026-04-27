import $ from "dartsx/internal/client";

function createFactory() {
	let count = $.state(0);

	function Counter() {
		return $.jsx("button", {
			onclick: () => $.set(count, $.get(count) + 1),
			children: [() => $.get(count)]
		});
	}

	return Counter;
}