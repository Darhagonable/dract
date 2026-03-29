export component SwitchBasic() {
	state mode = 'a'

	render (
		<div>
			<button onclick={() => mode = mode === 'a' ? 'b' : 'a'}>toggle</button>
			{switch (mode) {
				case 'a':
					<span>Mode A</span>
					break;
				case 'b':
					<span>Mode B</span>
					break;
				default:
					<span>Unknown</span>
			}}
		</div>
	);
}
