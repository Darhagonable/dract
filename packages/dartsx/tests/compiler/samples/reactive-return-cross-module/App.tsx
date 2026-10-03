import { ProfileContext, useProfile } from './factory.ts'

// Cross-file: the factory module's signal-returning callables are unknown
// here at first compile — the project registry reports the consumption back
// (`derived x = fn()`) so the factory recompiles with raw returns, then this
// module recompiles with the return-shape info. Both forms below exercise it.
derived profile = useProfile()

component App() {
	derived { user } = ProfileContext()
	render (
		<div>
			<input bind:value={profile.name} />
			<p>{user}</p>
		</div>
	)
}
