component Child(bind 'display-name' as displayName: string) {
	render (
		<input bind:value={displayName} />
	)
}

export component App() {
	state form = { name: "world" }

	render (
		<div>
			<Child bind:display-name={form.name} />
			<p>Hello {form.name}</p>
		</div>
	)
}
