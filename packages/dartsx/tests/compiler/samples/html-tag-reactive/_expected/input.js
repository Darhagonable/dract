import $ from "dartsx/internal/client";

function Preview() {
	let markup = $.state("<p>hello</p>");

	return $.jsx("div", { children: [$.html(() => $.get(markup))] });
}