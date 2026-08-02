import { useSyncExternalStore } from 'octane';
import { createStore } from 'zustand/vanilla';

// Third-party imports work in the playground: bare specifiers resolve
// through esm.sh (this one becomes https://esm.sh/zustand/vanilla).
// useSyncExternalStore subscribes octane to the external store.
const store = createStore<{ count: number }>(() => ({ count: 0 }));

const increment = () => store.setState((state) => ({ count: state.count + 1 }));
const reset = () => store.setState({ count: 0 });

export default function App() {
	const count = useSyncExternalStore(store.subscribe, () => store.getState().count);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<h2 style={{ margin: 0 }}>{'Zustand count: ' + count}</h2>

			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={increment}>Increment</button>
				<button onClick={reset}>Reset</button>
			</div>

			<p style={{ opacity: 0.6 }}>
				The store lives outside octane entirely — any subscriber sees the same state.
			</p>
		</div>
	);
}
