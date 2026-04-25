import $ from "dartsx/internal/client";
function App() {
	let count = $.state(0);
	return $.jsx(Greeting, {
		name: "Alice",
		get count() {
			return $.get(count);
		}
	});
}
