import $ from "dartsx/internal/client";
function X() {
	return $.jsx($.Fragment, { children: [$.jsx("input", { type: "text" }), $.jsx("br")] });
}
