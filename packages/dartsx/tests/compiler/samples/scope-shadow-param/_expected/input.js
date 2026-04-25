import $ from "dartsx/internal/client";
function List() {
	let items = $.state([
		"a",
		"b",
		"c"
	]);
	const handler = (items) => {
		console.log(items.length);
		return items.join(", ");
	};
	return $.jsx("div", { children: [$.jsx("p", { children: [() => handler($.get(items))] }), $.for(() => $.get(items), (item) => $.jsx("span", { children: [item] }))] });
}
