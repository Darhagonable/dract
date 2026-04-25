import $ from "dartsx/internal/client";
function App() {
	let count = $.state(0);
	const obj = {
		count: 42,
		other: $.get(count)
	};
	return $.jsx("div", { children: [
		() => obj.count,
		" ",
		() => $.get(count)
	] });
}
