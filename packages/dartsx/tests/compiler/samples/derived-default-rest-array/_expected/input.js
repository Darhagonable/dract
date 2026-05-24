import $ from "dartsx/internal/client";

function Child() {
	const __destructured_0 = getContext(),
		first = $.derived(() => __destructured_0[0] !== undefined ? __destructured_0[0] : 1),
		rest = $.derived(() => __destructured_0.slice(1));

	return $.jsx("p", {
		children: [() => $.get(first), ":", () => rest[0], ":", () => rest[1]]
	});
}