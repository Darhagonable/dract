import $ from "dartsx/internal/client";
function App() {
	let mode = $.state("a");
	return $.jsx("div", { children: [$.if(() => $.get(mode) === "a", () => $.if(() => $.get(mode) === "a", () => $.jsx("p", { children: ["Nested A"] }), () => $.jsx("p", { children: ["Nested B"] })), () => $.jsx("span", { children: ["Fallback"] }))] });
}
