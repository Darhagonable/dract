import $ from "dartsx/internal/client";

function Search() {
	let query = $.state("");
	let results = $.state([]);

	function doSearch() {
		for (let i = 0; i < results.length; i++) {
			const query = results[i].text;

			console.log(query.toLowerCase());
		}

		for (const query of getQueries()) {
			fetch(`/api?q=${query}`);
		}
	}

	return $.jsx("div", {
		children: [
			$.jsx("input", {
				get value() {
					return $.get(query);
				}
			}),
			$.jsx("button", { onclick: doSearch, children: ["search"] }),
			$.jsx("p", {
				children: [
					() => results.length,
					" results for \"",
					() => $.get(query),
					"\""
				]
			})
		]
	});
}