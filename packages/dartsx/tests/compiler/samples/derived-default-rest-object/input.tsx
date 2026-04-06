component Child() {
	derived { user: { name = 'anon' }, ...rest } = getContext()
	render (
		<p>{name}:{rest.role}:{rest.version}</p>
	)
}
