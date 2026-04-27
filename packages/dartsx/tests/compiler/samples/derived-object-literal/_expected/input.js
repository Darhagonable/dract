import $ from "dartsx/internal/client";

function App() {
	let count = $.state(0);
	const obj = $.derived(() => ({ count: $.get(count), doubled: $.get(count) * 2 }));

	return $.jsx("p", { children: [() => obj.count, " - ", () => obj.doubled] });
}