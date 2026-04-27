import $ from "dartsx/internal/client";

function App() {
	let data = $.state({ render: () => "hello" });
	const result = data.render();

	return $.jsx("div", { children: [result] });
}