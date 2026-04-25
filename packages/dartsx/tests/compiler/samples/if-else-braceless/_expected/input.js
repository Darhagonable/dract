import $ from "dartsx/internal/client";
function App() {
	let mode = $.state(true);
	return $.jsx("div", { children: [$.if(() => $.get(mode), () => $.jsx("p", { children: ["On"] }), () => $.jsx("p", { children: ["Off"] }))] });
}
