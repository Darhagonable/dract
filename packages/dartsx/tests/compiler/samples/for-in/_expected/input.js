import $ from "dartsx/internal/client";

function App() {
	let obj = $.state({ a: 1, b: 2 });

	return $.jsx("ul", {
		children: [
			$.for(() => Object.keys($.get(obj)), (key) => $.jsx("li", { children: [key] }))
		]
	});
}