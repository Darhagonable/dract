import $ from "dartsx/internal/client";
function App() {
	return $.jsx("div", { children: [() => {
		const a = "Hello";
		return $.jsx("p", { children: [a] });
	}] });
}
