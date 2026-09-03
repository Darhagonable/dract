component HighlightDemo(label, count = 0) {
	state active = true
	derived status = active ? "on" : "off"
	render (
		<section>
			<h1>{label}</h1>
			<input bind:value={count} />
			<Badge 'data-id' as dataId={status} />
		</section>
	)
}
