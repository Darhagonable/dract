import $ from "dartsx/internal/client";

function Child() {
	const __destructured_0 = getContext(),
		name = $.derived(() => __destructured_0.user.name !== undefined ? __destructured_0.user.name : "anon"),
		rest = $.derived(() => (({ user, ...rest }) => rest)(__destructured_0));

	return $.jsx("p", {
		children: [
			() => $.get(name),
			":",
			() => rest.role,
			":",
			() => rest.version
		]
	});
}