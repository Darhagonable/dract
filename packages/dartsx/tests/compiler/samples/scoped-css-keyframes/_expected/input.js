import $ from "dartsx/internal/client";

function FadeIn() {
	$.style("1r90v9w", "@keyframes 1r90v9w-fadeIn {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}\ndiv[data-scope~=\"1r90v9w\"] { animation: 1r90v9w-fadeIn 0.3s; }\np[data-scope~=\"1r90v9w\"] { color: blue; }\n");

	return $.jsx("div", {
		"data-scope": "1r90v9w",
		children: [
			$.jsx("p", { "data-scope": "1r90v9w", children: ["Animated"] })
		]
	});
}