import $ from "dartsx/internal/client";
import { createLogger, combineSignals } from "./helpers";

export function Dashboard() {
	let width = $.state(800);
	let height = $.state(600);
	const logWidth = createLogger("width");

	logWidth($.get(width));

	const area = $.derived(() => combineSignals(width, height, (w, h) => w * h));

	return $.jsx("div", {
		children: [
			$.jsx("p", {
				children: ["Size: ", () => $.get(width), "x", () => $.get(height)]
			}),
			$.jsx("p", { children: ["Area: ", () => $.get(area)] }),
			$.jsx("button", {
				onclick: () => $.set(width, $.get(width) + 100),
				children: ["wider"]
			})
		]
	});
}