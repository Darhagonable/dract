import $ from "dartsx/internal/client";

export function Counter() {
	let count = $.state(0);

	return $.jsx("button", {
		onclick: () => $.set(count, $.get(count) + 1),
		children: [() => $.get(count)]
	});
}