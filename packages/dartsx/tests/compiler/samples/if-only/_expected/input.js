import $ from "dartsx/internal/client";

function App() {
	let loaded = $.state(false);

	return $.jsx("div", {
		children: [
			$.if(() => $.get(loaded), () => $.jsx("p", { children: ["Content"] }))
		]
	});
}