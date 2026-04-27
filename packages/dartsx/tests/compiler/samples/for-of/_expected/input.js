import $ from "dartsx/internal/client";

function App() {
	let items = $.state(["a", "b", "c"]);

	return $.jsx("ul", {
		children: [
			$.for(() => $.get(items), (item) => $.jsx("li", { children: [item] }))
		]
	});
}