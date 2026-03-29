export component ElseIf() {
	state mode = 'a'

	render (
		<div>
			<button onclick={() => mode = mode === 'a' ? 'b' : mode === 'b' ? 'c' : 'a'}>cycle</button>
			{if (mode === 'a') {
				<span>A</span>
			} else if (mode === 'b') {
				<span>B</span>
			} else {
				<span>C</span>
			}}
		</div>
	);
}
