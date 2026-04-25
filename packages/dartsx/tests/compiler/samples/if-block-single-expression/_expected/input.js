import $ from "dartsx/internal/client";
function App() {
	let count = $.state(0);
	return $.jsx("div", { children: [$.if(() => $.get(count) > 0, () => $.jsx("span", { children: [() => $.get(count), " items"] }), () => $.jsx("span", { children: ["no items"] }))] });
}
