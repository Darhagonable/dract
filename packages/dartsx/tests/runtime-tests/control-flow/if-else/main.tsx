export component IfElse() {
	state x = true;

	render (
		<div>
			<button onclick={() => x = !x}>toggle</button>
			{if (x) {
				<span>truthy</span>
			} else {
				<span>falsy</span>
			}}
		</div>
	);
}
