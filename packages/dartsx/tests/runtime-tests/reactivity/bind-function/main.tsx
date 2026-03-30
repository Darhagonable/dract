export component App() {
	state value = "Hello";

	render (
		<div>
			<input bind:value={
				() => value,
				(v) => value = v.toUpperCase()
			} />
			<p>{value}</p>
		</div>
	);
}
