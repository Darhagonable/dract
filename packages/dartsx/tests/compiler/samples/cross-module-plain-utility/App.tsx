import { formatCount } from './format'

export component App() {
	state count = 0;

	render (
		<div>
			<p>{formatCount(count)}</p>
			<button onclick={count++}>increment</button>
		</div>
	)
}
