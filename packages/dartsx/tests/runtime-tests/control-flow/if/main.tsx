export component Truthy() {
	state x = true;

	render (
		<div>
			<button onclick={() => x = !x}>toggle</button>
			{if (x) {
				<span>truthy</span>
			}}
		</div>
	);
}
