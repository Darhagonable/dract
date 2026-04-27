import $ from "dartsx/internal/client";
import { count, increment } from "./store";

function App() {
	return $.jsx("div", {
		children: [
			$.jsx("span", { children: [() => $.get(count)] }),
			$.jsx("button", { onclick: increment, children: ["+1"] })
		]
	});
}