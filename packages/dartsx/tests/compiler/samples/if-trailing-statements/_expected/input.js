import $ from "dartsx/internal/client";

function App() {
	let show = $.state(true);
	let effects = $.state([]);

	return $.jsx("div", {
		children: [
			(() => {
				const $$cf0 = $.if(() => $.get(show), () => $.jsx("p", { children: ["Hello"] }));

				effects.push("ran");

				return $$cf0;
			})()
		]
	});
}