import $ from "dartsx/internal/client";
function App() {
	let count = $.state(0);
	return $.jsx("div", { children: [() => {
		const label = "Count";
		return $.jsx("p", { children: [
			label,
			": ",
			() => $.get(count)
		] });
	}] });
}
