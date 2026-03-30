component Child(bind name) {
	render (
		<input bind:value={name} />
	);
}

export component App() {
	state form = { name: "world" };

	render (
		<div>
			<Child bind:name={form.name} />
			<p>Hello {form.name}</p>
		</div>
	);
}
