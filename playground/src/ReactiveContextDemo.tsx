import { createContext, provide } from "dartsx";

const CounterContext = createContext(() => {
	state count = 0
	const increment = () => count++
	return { count, increment }
})

component Parent() {
	provide(CounterContext)
	render (
		<div>
			<Controls />
			<Display />
		</div>
	)
}

component Controls() {
	derived { count, increment } = CounterContext()

	render <button onclick={increment}>Increment {count}</button>
}

component Display() {
	derived { count, increment } = CounterContext()

	render <p>Count: {count}</p>
}

export component ReactiveContextDemo() {
	render (
		<div>
			<h2>Reactive Context</h2>
			<Parent />
		</div>
	)
}
