import $ from "dartsx/internal/client";

export let count = $.state(0);

export function increment() {
	$.set(count, $.get(count) + 1);
}