import $ from "dartsx/internal/client";

function App() {
	let items = $.state([{ name: "a" }, { name: "b" }, { name: "c" }]);

	return $.jsx("ul", {
		children: [
			$.for(() => $.get(items), (item) => {
				const name = item.name;

				return $.jsx("li", { children: [name] });
			})
		]
	});
}