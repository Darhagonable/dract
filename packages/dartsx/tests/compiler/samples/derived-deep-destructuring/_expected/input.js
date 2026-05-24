import $ from "dartsx/internal/client";

function Child() {
	const __destructured_0 = getContext(),
		count = $.derived(() => __destructured_0.data.counter.count),
		increment = $.derived(() => __destructured_0.data.counter.increment),
		label = $.derived(() => __destructured_0.data.values[0]),
		arrayCount = $.derived(() => __destructured_0.data.values[1].count);

	return $.jsx("button", {
		get onclick() {
			return $.get(increment);
		},

		children: [
			() => $.get(label),
			":",
			() => $.get(count),
			":",
			() => $.get(arrayCount)
		]
	});
}