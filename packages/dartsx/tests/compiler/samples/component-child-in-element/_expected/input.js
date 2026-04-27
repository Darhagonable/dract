import $ from "dartsx/internal/client";

function App() {
	return $.jsx("div", { children: [$.jsx(Child)] });
}