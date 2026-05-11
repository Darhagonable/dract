import $ from "dartsx/internal/client";

function App() {
	function greet() {
		return "hello";
	}

	let fn = $.state(Object.assign(greet, { count: 0 }));

	return $.jsx($.Fragment, {
		children: [
			$.jsx("button", { onclick: () => fn.count++, children: ["inc"] }),
			$.jsx("span", { children: [() => fn.count] }),
			$.jsx("span", { children: [() => fn()] })
		]
	});
}