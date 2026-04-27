import $ from "dartsx/internal/client";
import { effect } from "dartsx";

export function createLogger(label) {
	return function log(value) {
		effect(value, (val) => console.log(`[${label}]`, val));
	};
}

export function combineSignals(a, b, fn) {
	const result = $.derived(() => fn($.get(a), $.get(b)));

	return result;
}