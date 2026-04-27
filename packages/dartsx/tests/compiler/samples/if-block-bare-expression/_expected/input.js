import $ from "dartsx/internal/client";

function App() {
	let count = $.state(0);

	return $.jsx("div", {
		children: [$.if(() => $.get(count) > 0, () => $.get(count), () => 0)]
	});
}