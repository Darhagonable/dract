component Child() {
	derived { data: { counter: { count, increment }, values: [label, { count: arrayCount }] } } = getContext()
	render (
		<button onclick={increment}>{label}:{count}:{arrayCount}</button>
	)
}
