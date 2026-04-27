import $ from "dartsx/internal/client";

function App() {
	let count = $.state(0);

	function reset() {
		const count = getInitialCount();

		console.log(count);

		return count;
	}

	return $.jsx("div", {
		children: [
			$.jsx("p", { children: [() => $.get(count)] }),
			$.jsx("button", {
				onclick: () => $.set(count, $.get(count) + 1),
				children: ["inc"]
			}),
			$.jsx("button", { onclick: reset, children: ["reset"] })
		]
	});
}