import $ from "dartsx/internal/client";
import { count, increment } from "./store";

export default function App() {
	return $.jsx("button", {
		onclick: increment,
		children: ["clicks: ", () => $.get(count)]
	});
}