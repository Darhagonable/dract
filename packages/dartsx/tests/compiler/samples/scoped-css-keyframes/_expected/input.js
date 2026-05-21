import $ from "dartsx/internal/client";

function FadeIn() {
	$.style("ydfvs1", "@keyframes ydfvs1-fadeIn {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}\ndiv[data-scope~=\"ydfvs1\"] { animation: ydfvs1-fadeIn 0.3s; }\np[data-scope~=\"ydfvs1\"] { color: blue; }\n");

	return $.jsx("div", {
		"data-scope": "ydfvs1",
		children: [
			$.jsx("p", { "data-scope": "ydfvs1", children: ["Animated"] })
		]
	});
}