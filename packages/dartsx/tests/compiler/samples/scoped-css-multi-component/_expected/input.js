import $ from "dartsx/internal/client";

function CardHeader() {
	$.style("7ghgsd", "header[data-scope~=\"7ghgsd\"] { border-bottom: 1px solid; }\n");

	return $.jsx("header", { "data-scope": "7ghgsd", children: ["Header"] });
}

function CardBody() {
	$.style("1k7chr6", "div[data-scope~=\"1k7chr6\"] { padding: 16px; }\n");

	return $.jsx("div", { "data-scope": "1k7chr6", children: ["Body"] });
}