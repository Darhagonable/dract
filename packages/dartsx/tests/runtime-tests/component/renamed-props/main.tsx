component Greeting(
	'first-name' as firstName: string,
	'user-age' as age: number = 18,
) {
	render (
		<section>
			<h1>{firstName}</h1>
			<p>Age: {age}</p>
		</section>
	)
}

export component App() {
	render (
		<div>
			<Greeting first-name="Alice" />
			<Greeting first-name="Bob" user-age={42} />
		</div>
	)
}
