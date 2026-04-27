import $ from "dartsx/internal/client";

export function numberFormat(value) {
	return $.get(value).toLocaleString();
}