function createCounter() {
	let count = $.state(0);
	const increment = () => $.set(count, $.get(count) + 1);
	return {
		get count() {
			return $.get(count);
		},
		increment
	};
}
