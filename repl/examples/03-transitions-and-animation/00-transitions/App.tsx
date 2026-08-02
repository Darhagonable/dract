import { useState, useDeferredValue, useTransition } from 'octane';

// useDeferredValue lets the slow list lag one step behind the input, and
// useTransition keeps the UI responsive while a heavy update commits.
const WORDS = ['ember', 'orchid', 'quartz', 'saffron', 'thistle', 'umbra', 'verdant', 'willow'];
const ITEMS = Array.from({ length: 1500 }, (_, i) => WORDS[i % WORDS.length] + '-' + i);

function SlowList(props: { query: string }) {
	// Artificial cost so the deferral is visible.
	const start = performance.now();
	while (performance.now() - start < 40) {
		// busy-wait ~40ms per render
	}
	const matches = ITEMS.filter((item) => item.includes(props.query)).slice(0, 12);

	if (matches.length === 0) return <li style={{ opacity: 0.6 }}>no matches</li>;

	return (
		<ul style={{ margin: 0 }}>
			{matches.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
}

export default function App() {
	const [query, setQuery] = useState('');
	const deferredQuery = useDeferredValue(query);
	const [isPending, startTransition] = useTransition();
	const [sorted, setSorted] = useState(false);
	const isStale = query !== deferredQuery;

	return (
		<div style={{ display: 'grid', gap: '0.75rem' }}>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<input
					placeholder="type to filter 1500 items…"
					value={query}
					onInput={(e) => setQuery(e.currentTarget.value)}
					style={{
						padding: '0.3rem 0.5rem',
						borderRadius: '6px',
						border: '1px solid #8886',
						background: 'transparent',
						color: 'inherit',
						minWidth: '16rem',
					}}
				/>
				<button onClick={() => startTransition(() => setSorted(!sorted))}>
					{isPending ? 'Sorting…' : sorted ? 'Unsort' : 'Sort'}
				</button>
			</div>

			<div
				style={{
					padding: '0.75rem',
					border: '1px solid #8884',
					borderRadius: '8px',
					transition: 'opacity 0.15s',
					opacity: isStale ? 0.5 : undefined,
				}}
			>
				<SlowList query={sorted ? deferredQuery.split('').sort().join('') : deferredQuery} />
			</div>
		</div>
	);
}
