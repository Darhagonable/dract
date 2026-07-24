import $ from "dartsx/internal/client";

function App() {
	let items = $.state(["a", "b", "c"]);

	return $.jsx("ul", {
		children: [() => items.map((item) => $.jsx("li", { children: [item] }))]
	});
}