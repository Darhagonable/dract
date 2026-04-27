import $ from "dartsx/internal/client";

function CardHeader() {
	$.style("1bqdbis", "header[data-scope~=\"1bqdbis\"] { border-bottom: 1px solid; }\n");

	return $.jsx("header", { "data-scope": "1bqdbis", children: ["Header"] });
}

function CardBody() {
	$.style("8vxpx5", "div[data-scope~=\"8vxpx5\"] { padding: 16px; }\n");

	return $.jsx("div", { "data-scope": "8vxpx5", children: ["Body"] });
}