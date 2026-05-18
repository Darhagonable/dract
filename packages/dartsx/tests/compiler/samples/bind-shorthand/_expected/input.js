import $ from "dartsx/internal/client";

function X() {
	let value = $.state("");

	return $.jsx("input", {
		get value() {
			return $.get(value);
		},

		set value(v) {
			$.set(value, v);
		}
	});
}