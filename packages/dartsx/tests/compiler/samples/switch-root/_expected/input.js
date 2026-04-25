import $ from "dartsx/internal/client";
function App() {
	let mode = $.state("a");
	return $.switch(() => $.get(mode), [{
		values: ["a"],
		fn: () => $.jsx("p", { children: ["A"] })
	}, {
		values: ["b"],
		fn: () => $.jsx("p", { children: ["B"] })
	}]);
}
