component Greeting(name: string) {
	render (
		<h1>Hello, {name}!</h1>
	);
}

export component App() {
	render (
		<Greeting name="Alice" />
	);
}
