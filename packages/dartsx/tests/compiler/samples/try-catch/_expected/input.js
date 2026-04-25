import $ from "dartsx/internal/client";
function App() {
	return $.jsx("div", { children: [$.try(() => $.jsx("p", { children: ["Content"] }), (e) => $.jsx("p", { children: ["Error occurred"] }))] });
}
