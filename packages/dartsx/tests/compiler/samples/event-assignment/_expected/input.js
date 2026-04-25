import $ from "dartsx/internal/client";
function X() {
	let isOpen = $.state(false);
	return $.jsx("button", {
		onclick: () => $.set(isOpen, true),
		children: ["open"]
	});
}
