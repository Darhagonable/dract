import $ from "dartsx/internal/client";
function Responsive() {
	$.style("1u9moac", "div[data-scope~=\"1u9moac\"] { padding: 16px; }\n@media (max-width: 768px) {\n  p[data-scope~=\"1u9moac\"] { font-size: 12px; }\n}\n");
	return $.jsx("div", {
		"data-scope": "1u9moac",
		children: [$.jsx("p", {
			"data-scope": "1u9moac",
			children: ["Content"]
		})]
	});
}
