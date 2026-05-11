import $ from "dartsx/internal/client";

function App() {
	let currentPath = $.state(window.location.pathname);
	let someVal = $.state(externalVar);
	const slug = $.derived(() => $.get(currentPath).startsWith("/docs/") ? $.get(currentPath).slice(6) : "");
	const upper = $.derived(() => $.get(someVal).toUpperCase());

	return $.jsx("div", { children: [() => $.get(slug), " ", () => $.get(upper)] });
}