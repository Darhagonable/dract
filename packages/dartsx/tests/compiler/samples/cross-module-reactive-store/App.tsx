import { count, increment } from './store';

export default component App() {
	render (
		<button onclick={increment}>
			clicks: {count}
		</button>
	);
}
