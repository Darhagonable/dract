import $ from "dartsx/internal/client";
function Test() {
	const items = $.derived(() => [{
		ok: true,
		a: "x",
		b: "y"
	}]);
	return $.for(() => $.get(items), (item) => $.jsx("div", { children: [$.if(() => item.ok, () => $.jsx($.Fragment, { children: [$.jsx("span", { children: [item.a] }), $.jsx("span", { children: [item.b] })] }))] }));
}
