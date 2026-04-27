import $ from "dartsx/internal/client";

function Article($$props) {
	const content = $.prop($$props, "content");

	return $.jsx("article", { children: [$.html(() => $.get(content))] });
}