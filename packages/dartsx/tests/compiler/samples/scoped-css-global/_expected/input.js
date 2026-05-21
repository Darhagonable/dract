import $ from "dartsx/internal/client";

function App() {
	$.style("1ap7hob", "body { margin: 0; }\n* { box-sizing: border-box; }");

	return $.jsx("div", { children: [$.jsx("p", { children: ["Hello"] })] });
}