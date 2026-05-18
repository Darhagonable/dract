import $ from "dartsx/internal/client";

function Layout() {
	let width = $.state(0);

	return $.jsx("div", {
		set clientWidth(v) {
			$.set(width, v);
		},
		children: ["content"]
	});
}