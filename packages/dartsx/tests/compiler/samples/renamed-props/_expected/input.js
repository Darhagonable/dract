import $ from "dartsx/internal/client";
function RenamedProps($$props) {
	const foo = $.prop($$props, "required-renamed");
	const baz = $.prop($$props, "optional-with-default", 3);
	return $.jsx("div", { children: [
		() => $.get(foo),
		" ",
		() => $.get(baz)
	] });
}
