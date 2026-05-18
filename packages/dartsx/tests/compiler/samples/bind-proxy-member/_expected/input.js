import $ from "dartsx/internal/client";

function Form() {
	let form = $.state({ name: "", email: "" });

	return $.jsx("input", {
		get value() {
			return form.name;
		},

		set value(v) {
			form.name = v;
		}
	});
}