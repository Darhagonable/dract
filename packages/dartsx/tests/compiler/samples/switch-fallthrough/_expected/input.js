import $ from "dartsx/internal/client";

function App() {
	let status = $.state("init");

	return $.jsx("div", {
		children: [
			$.switch(() => $.get(status), [
				{
					values: ["init", "loading"],
					fn: () => $.jsx("p", { children: ["Loading..."] })
				},

				{
					values: ["success"],
					fn: () => $.jsx("p", { children: ["Done!"] })
				}
			])
		]
	});
}