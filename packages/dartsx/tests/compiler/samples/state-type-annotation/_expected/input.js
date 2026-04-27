import $ from "dartsx/internal/client";

function App() {
	let name = $.state("hello");
	let count = $.state(0);

	return $.jsx("div", { children: [() => $.get(name), " ", () => $.get(count)] });
}