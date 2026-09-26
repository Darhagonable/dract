import $ from "dartsx/internal/client";

function App() {
	let count = $.state(0);
	let log = $.state([]);

	return $.jsx("div", {
		children: [
			$.jsx("button", {
				onclick: () => {
					if ($.get(count) === 0) $.set(count, 1); else $.set(count, 0);

					log.push("clicked");
				},
				children: ["toggle"]
			}),

			$.jsx("button", {
				onclick: () => {
					for (let i = 0; i < 3; i++) log.push("i" + i);

					log.push("done");
				},
				children: ["loop"]
			}),

			$.jsx("button", {
				onclick: () => {
					try {
						log.push("tried");
					} catch(e) {
						log.push("failed");
					}

					log.push("after");
				},
				children: ["try"]
			}),
			" ",
			" ",
			$.if(() => $.get(count) > 0, () => $.jsx("p", { children: [() => $.get(count)] })),
			$.for(
				() => $.get(log),
				(entry) => {
					return $.jsx("li", { children: [entry] });
				},
				(entry) => entry
			)
		]
	});
}