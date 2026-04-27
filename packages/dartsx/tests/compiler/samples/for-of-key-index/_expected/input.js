import $ from "dartsx/internal/client";

function App() {
	let todos = $.state([{ id: 1, text: "a" }]);

	return $.jsx("ul", {
		children: [
			$.for(() => $.get(todos), (todo, i) => $.jsx("li", { children: [todo.text] }), (todo) => todo.id)
		]
	});
}