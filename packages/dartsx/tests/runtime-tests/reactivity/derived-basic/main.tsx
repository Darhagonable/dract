export component DerivedBasic() {
	state count = 2;
	derived doubled = count * 2;

	render (
		<button onclick={() => count++}>{count}</button>
		<p>{doubled}</p>
	);
}
