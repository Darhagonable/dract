import $ from "dartsx/internal/client";

function App() {
	const obj = { x: 1, y: 2 };
	let data = $.state(obj);

	return $.jsx("div", { children: [() => data.x] });
}