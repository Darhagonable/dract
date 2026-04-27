import $ from "dartsx/internal/client";

function Counter() {
	let count = $.state(0);
	const doubled = $.derived(() => $.get(count) * 2);

	return $.jsx("div", {
		children: [
			$.jsx("button", {
				onclick: () => $.set(count, $.get(count) + 1),
				children: ["+1"]
			}),
			$.jsx("span", { children: [() => $.get(count)] }),
			$.jsx("span", { children: ["doubled: ", () => $.get(doubled)] })
		]
	});
}