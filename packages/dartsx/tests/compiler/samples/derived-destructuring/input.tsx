component Child() {
	derived { count, increment } = getContext()
	render (
		<button onclick={increment}>Count: {count}</button>
	)
}
