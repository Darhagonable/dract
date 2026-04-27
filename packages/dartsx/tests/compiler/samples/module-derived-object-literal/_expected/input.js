import $ from "dartsx/internal/client";

let count = $.state(0);
const obj = $.derived(() => ({ count: $.get(count), doubled: $.get(count) * 2 }));

function App() {
	return $.jsx("p", { children: [() => obj.count, " - ", () => obj.doubled] });
}