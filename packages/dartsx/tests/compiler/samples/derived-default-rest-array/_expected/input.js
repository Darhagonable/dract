import $ from "dartsx/internal/client";
function Child() {
	const __derived_0 = getContext();
	const first = $.derived(() => {
		const __value = __derived_0[0];
		return __value === undefined ? 1 : __value;
	});
	const rest = $.derived(() => __derived_0.slice(1));
	return $.jsx("p", { children: [
		() => $.get(first),
		":",
		() => rest[0],
		":",
		() => rest[1]
	] });
}
