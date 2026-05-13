import $ from "dartsx/internal/client";

function App() {
	let items = $.state([{ name: "a" }, { name: "b" }, { name: "c" }]);

	return $.jsx("div", {
		children: [
			() => {
				const filtered = items.filter((i) => i.name !== "a");

				return $.for(() => filtered, (item) => {
					$.jsx("p", { children: [item.name] });
				});
			}
		]
	});
}