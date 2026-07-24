import $ from "dartsx/internal/client";

function App() {
	let items = $.state(["a", "b"]);

	return $.jsx("ul", {
		children: [
			() => items.map((item, i) => $.jsx("li", { children: [i, ": ", item] }))
		]
	});
}