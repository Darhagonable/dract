component Button(label: string) {
	render (
		<button>{label}</button>
	);
}

export component App() {
	render (
		<div>
			<Button label="Click me" />
			<Button label="Submit" />
		</div>
	);
}
