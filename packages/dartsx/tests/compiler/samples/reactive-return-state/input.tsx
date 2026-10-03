import { createContext, provide } from "dartsx";

// A bare signal through context: the factory returns the state binding
// itself and the consumer binds it raw with `derived` — reads and writes
// hit the context's signal directly.
export const NameContext = createContext((initialName: string) => {
	state name = initialName
	return name
})

component NameForm() {
	derived name = NameContext()
	render (
		<div>
			<input bind:value={name} />
			<button onclick={() => (name = "Alice")}>Reset</button>
		</div>
	)
}

export component Demo() {
	provide(NameContext, "Alice")
	render <NameForm />
}
