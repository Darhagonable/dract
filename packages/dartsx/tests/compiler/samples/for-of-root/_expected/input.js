import $ from "dartsx/internal/client";
function App() {
	let items = $.state([
		1,
		2,
		3
	]);
	return $.for(() => $.get(items), (n) => $.jsx("p", { children: [n] }));
}
