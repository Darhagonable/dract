import $ from "dartsx/internal/client";
function Child() {
	const __derived_0 = getContext();
	const count = $.derived(() => __derived_0.data.counter.count);
	const increment = $.derived(() => __derived_0.data.counter.increment);
	const label = $.derived(() => __derived_0.data.values[0]);
	const arrayCount = $.derived(() => __derived_0.data.values[1].count);
	return $.jsx("button", {
		onclick: $.get(increment),
		children: [
			() => $.get(label),
			":",
			() => $.get(count),
			":",
			() => $.get(arrayCount)
		]
	});
}
