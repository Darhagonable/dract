import { useState } from 'octane';

export default function App() {
	const [count, setCount] = useState(0);
	const [items, setItems] = useState<string[]>([]);

	const addItem = () => {
		setItems([...items, 'Item #' + (items.length + 1)]);
	};

	return (
		<div style={{ display: 'grid', gap: '0.5rem', justifyItems: 'start' }}>
			<h2>{'Count: ' + count}</h2>

			<button onClick={() => setCount(count + 1)}>Increment</button>
			<button onClick={addItem}>Add item</button>

			{count >= 5 ? <p style={{ color: '#ff5d72' }}>Count is heating up!</p> : null}

			<ul style={{ margin: 0 }}>
				{items.length === 0 ? (
					<li style={{ opacity: 0.6 }}>No items yet — add one.</li>
				) : (
					items.map((item) => <li key={item}>{item}</li>)
				)}
			</ul>
		</div>
	);
}
