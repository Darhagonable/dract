export component Counter() {
	state count = 0;

	render (
		<button onclick={() => count++}>
			clicks: {count}
		</button>
	);
}
