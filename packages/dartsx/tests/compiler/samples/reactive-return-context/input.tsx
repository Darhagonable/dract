import { createContext, provide } from "dartsx";

// A signal bag through context. The canonical shape holds the bag in a
// `derived ctx` — reactivity requires derived/state at every binding, so
// plain `const` locals are snapshots. Reactive shorthands become accessor
// pairs: state-kind writes propagate through the setter, derived-kind
// writes are legal-but-inert. Consumers opt in with `derived` at the call
// site.
export const MyContext = createContext((initial: string) => {
	state name = initial
	derived length = name.length
	derived ctx = { name, length }
	return ctx
})

component Writer() {
	derived { name, length } = MyContext()
	render (
		<div>
			<input bind:value={name} />
			<button onclick={() => (name = "something new")}>write</button>
			<span>{length}</span>
		</div>
	)
}

component Reader() {
	derived ctx = MyContext()
	render (
		<div>
			<p>{ctx.name}</p>
			<button onclick={() => (ctx.name = "via ctx")}>ctx write</button>
		</div>
	)
}

export component Demo() {
	provide(MyContext, "default")
	render (
		<div>
			<Writer />
			<Reader />
		</div>
	)
}
