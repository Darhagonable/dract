import $ from "dartsx/internal/client";

export let user = $.state({ name: "alice", role: "admin" });
export let count = $.state(0);

export function resetCount() {
	$.set(count, 0);
}