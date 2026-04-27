import $ from "dartsx/internal/client";

function App() {
	let status = $.state("loading");

	return $.jsx("div", {
		children: [
			$.switch(() => $.get(status), [
				{
					values: ["loading"],
					fn: () => {
						const loadMsg = "Please wait...";

						return $.jsx("p", { children: [loadMsg] });
					}
				},

				{
					values: ["success"],
					fn: () => {
						const okMsg = "Done!";

						return $.jsx("p", { children: [okMsg] });
					}
				},

				{
					values: null,
					fn: () => {
						const defMsg = "Unknown";

						return $.jsx("p", { children: [defMsg] });
					}
				}
			])
		]
	});
}