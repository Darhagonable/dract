import { useState, use, Suspense, ErrorBoundary } from 'octane';

// A compiled Octane island hosted by the React tree in App.react.tsx.
// It keeps its own state, native events, and Suspense boundary.
function fakeFetch(attempt: number) {
	return new Promise<string>((resolve) => {
		setTimeout(() => resolve('island data #' + attempt), 700);
	});
}

// Creating the promise AT the use() call site lets octane memoize it per
// call site + deps, so unrelated re-renders (the click counter) never
// resuspend the boundary — only a changed attempt refetches.
function IslandData(props: { attempt: number }) {
	const data = use(fakeFetch(props.attempt));

	return <p style={{ margin: 0 }}>{data}</p>;
}

export function Island(props: { start: number }) {
	const [count, setCount] = useState(props.start);
	const [attempt, setAttempt] = useState(1);

	return (
		<section
			style={{
				padding: '0.9rem 1.1rem',
				border: '1px dashed #ff5d72aa',
				borderRadius: '10px',
				display: 'grid',
				gap: '0.5rem',
				justifyItems: 'start',
			}}
		>
			<h3 style={{ margin: 0, color: '#ff5d72' }}>Octane island</h3>

			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={() => setCount(count + 1)}>{'clicks: ' + count}</button>
				<button onClick={() => setAttempt(attempt + 1)}>Refetch</button>
			</div>

			<ErrorBoundary
				fallback={(error: Error) => <p style={{ margin: 0, color: '#ff5d72' }}>{error.message}</p>}
			>
				<Suspense fallback={<p style={{ margin: 0, opacity: 0.6 }}>island loading…</p>}>
					<IslandData attempt={attempt} />
				</Suspense>
			</ErrorBoundary>
		</section>
	);
}
