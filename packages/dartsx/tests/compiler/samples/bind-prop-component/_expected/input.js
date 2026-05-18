import $ from "dartsx/internal/client";

function Parent() {
	let name = $.state("hello");

	return $.jsx(Child, {
		get name() {
			return $.get(name);
		},

		set name(v) {
			$.set(name, v);
		}
	});
}