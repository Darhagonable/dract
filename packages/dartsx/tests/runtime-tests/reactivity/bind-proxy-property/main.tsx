export component Form() {
	state form = { name: "world" };

	render (
		<div>
			<input bind:value={form.name} />
			<p>Hello {form.name}</p>
		</div>
	);
}
