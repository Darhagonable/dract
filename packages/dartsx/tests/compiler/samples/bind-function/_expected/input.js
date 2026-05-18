import $ from "dartsx/internal/client";

function Form() {
	let value = $.state("hello");

	return $.jsx("input", {
		get value() {
			return $.get(value);
		},

		set value(v) {
			$.set(value, v.toLowerCase());
		}
	});
}