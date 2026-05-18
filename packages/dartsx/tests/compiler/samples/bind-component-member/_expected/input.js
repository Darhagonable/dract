import $ from "dartsx/internal/client";

function Parent() {
	let form = $.state({ name: "" });

	return $.jsx(Child, {
		get name() {
			return form.name;
		},

		set name(v) {
			form.name = v;
		}
	});
}