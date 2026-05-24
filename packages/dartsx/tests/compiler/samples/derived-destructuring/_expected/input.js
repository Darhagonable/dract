import $ from "dartsx/internal/client";

function Child() {
	const __destructured_0 = getContext(),
		count = $.derived(() => __destructured_0.count),
		increment = $.derived(() => __destructured_0.increment);

	return $.jsx("button", {
		get onclick() {
			return $.get(increment);
		},
		children: ["Count: ", () => $.get(count)]
	});
}