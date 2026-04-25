import $ from "dartsx/internal/client";
function App() {
	let show = $.state(true);
	return $.jsx("div", { children: [$.if(() => $.get(show), () => $.jsx("p", { children: ["Visible"] }), () => $.jsx("span", { children: ["Hidden"] }))] });
}
