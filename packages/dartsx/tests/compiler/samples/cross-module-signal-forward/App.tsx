import { syncToStorage } from './sync'

export default component App() {
	state name = "alice"

	syncToStorage("name", name)

	render (
		<p>{name}</p>
	)
}
