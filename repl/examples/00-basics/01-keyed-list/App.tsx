import { useState } from 'octane';

// The same keyed list in React-style TSX — .map() with key props instead
// of the @for directive. Both dialects compile to the same runtime.
export default function App() {
	const [items, setItems] = useState([
		{ id: 1, label: 'apple' },
		{ id: 2, label: 'banana' },
		{ id: 3, label: 'cherry' },
	]);
	const [nextId, setNextId] = useState(4);

	const add = (position: 'start' | 'end') => {
		const item = { id: nextId, label: 'item ' + nextId };
		setNextId(nextId + 1);
		setItems(position === 'start' ? [item, ...items] : [...items, item]);
	};

	return (
		<div style={{ display: 'grid', gap: '0.75rem' }}>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={() => add('start')}>Prepend</button>
				<button onClick={() => add('end')}>Append</button>
				<button onClick={() => setItems([...items].reverse())}>Reverse</button>
				<button onClick={() => setItems([])}>Clear</button>
			</div>

			<ul style={{ margin: 0 }}>
				{items.length === 0 ? (
					<li style={{ opacity: 0.6 }}>Empty — add an item above.</li>
				) : (
					items.map((item) => (
						<li key={item.id}>
							{item.label}
							<button onClick={() => setItems(items.filter((x) => x.id !== item.id))}>
								×
							</button>
						</li>
					))
				)}
			</ul>
		</div>
	);
}
