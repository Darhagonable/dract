import $ from "dartsx/internal/client";

function App() {
	let count = $.state(5);

	return $.jsx("ul", {
		children: [
			$.for(
				() => {
					const __a = [];

					for (let i = 0; i < $.get(count); i++) __a.push(i);

					return __a;
				},
				(i) => $.jsx("li", { children: [i] })
			)
		]
	});
}