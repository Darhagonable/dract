import $ from "dartsx/internal/client";

function ErrorBoundary() {
	let error = $.state(null);

	function tryOperation() {
		try {
			riskyCall();
		} catch(error) {
			console.log(error.message);
			reportError(error);
		}
	}

	return $.jsx("div", {
		children: [
			$.if(
				() => $.get(error),
				() => {
					return $.jsx("p", { class: "error", children: [() => $.get(error)] });
				},
				() => {
					return $.jsx("button", { onclick: tryOperation, children: ["run"] });
				}
			)
		]
	});
}