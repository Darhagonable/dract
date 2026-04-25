import $ from "dartsx/internal/client";
function runTest() {
	function Greeting($props) {
		const name = $.prop($props, "name", "world");
		let count = $.state(0);
		return $.jsx("div", { children: [
			"Hello ",
			() => $.get(name),
			" ",
			() => $.get(count)
		] });
	}
	return Greeting;
}
