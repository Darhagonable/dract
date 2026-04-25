import $ from "dartsx/internal/client";
export default function TypedComponent() {
	let headings = $.state([]);
	let activeId = $.state("");
	let observer = null;
	function processItems(items) {
		return items.map((item) => item.text);
	}
	const labels = processItems($.get(headings));
	return $.jsx("div", { children: [$.jsx("h1", { children: [() => $.get(activeId)] }), $.for(() => labels, (label) => $.jsx("span", { children: [label] }))] });
}
