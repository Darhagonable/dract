import $ from "dartsx/internal/client";

function search(query) {
	if (!$.get(query).trim()) return [];

	return [$.get(query)];
}

function SearchBox() {
	let query = $.state("");
	let results = $.derived(() => search(query));

	return $.jsx("ul", {
		children: [
			$.for(() => $.get(results), (r) => {
				$.jsx("li", { children: [r] });
			})
		]
	});
}