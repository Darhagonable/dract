import $ from "dartsx/internal/client";
import { effect } from "dartsx";

function App() {
	let obj = $.state({ a: 1, b: 2 });

	effect([$.derived(() => obj.a), $.derived(() => obj.b)], ([a], [b]) => {
		console.log(a + b);
	});

	return $.jsx("p", { children: [() => obj.a] });
}