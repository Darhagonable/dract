import $ from "dartsx/internal/client";
function X() {
	return $.jsx("div", {
		class: "card",
		children: [$.jsx("p", { children: ["hello"] })]
	});
}
