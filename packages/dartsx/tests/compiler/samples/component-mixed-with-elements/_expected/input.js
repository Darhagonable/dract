import $ from "dartsx/internal/client";

function App() {
	return $.jsx($.Fragment, {
		children: [
			$.jsx("h1", { children: ["Title"] }),
			$.jsx(Child),
			$.jsx("p", { children: ["Footer"] })
		]
	});
}