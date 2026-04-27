import $ from "dartsx/internal/client";

function App() {
	return $.jsx("ul", {
		children: [
			$.for(
				() => {
					const __a = [];

					for (let i = 0; i < 5; i++) __a.push(i);

					return __a;
				},
				(i) => $.jsx("li", { children: [i] })
			)
		]
	});
}