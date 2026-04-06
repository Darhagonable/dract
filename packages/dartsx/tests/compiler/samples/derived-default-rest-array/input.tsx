component Child() {
	derived [first = 1, ...rest] = getContext()
	render (
		<p>{first}:{rest[0]}:{rest[1]}</p>
	)
}
