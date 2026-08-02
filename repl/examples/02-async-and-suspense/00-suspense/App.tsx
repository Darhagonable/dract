import { useState, use, Suspense, ErrorBoundary } from 'octane';

// <Suspense> + <ErrorBoundary> components for async data. use() suspends
// the boundary until the promise settles; a rejection routes to the
// boundary's fallback.
function fakeFetch(shouldFail: boolean, attempt: number) {
	return new Promise<string>((resolve, reject) => {
		setTimeout(() => {
			if (shouldFail) reject(new Error('simulated fetch failure'));
			else resolve('response #' + attempt + ': shipping is the feature');
		}, 800);
	});
}

// Creating the promise AT the use() call site lets octane memoize it per
// call site + deps — only changed inputs refetch; unrelated re-renders
// never resuspend the boundary.
function Quote(props: { shouldFail: boolean; attempt: number }) {
	const quote = use(fakeFetch(props.shouldFail, props.attempt));

	return <p>{'“' + quote + '”'}</p>;
}

export default function App() {
	const [attempt, setAttempt] = useState(1);
	const [shouldFail, setShouldFail] = useState(false);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
				<button onClick={() => setAttempt(attempt + 1)}>Refetch</button>
				<label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
					<input
						type="checkbox"
						checked={shouldFail}
						onChange={(e) => setShouldFail(e.currentTarget.checked)}
					/>
					simulate failure
				</label>
			</div>

			<ErrorBoundary
				fallback={(error: Error) => <p style={{ color: '#ff5d72' }}>{error.message}</p>}
			>
				<Suspense fallback={<p style={{ opacity: 0.6 }}>loading…</p>}>
					<Quote shouldFail={shouldFail} attempt={attempt} />
				</Suspense>
			</ErrorBoundary>
		</div>
	);
}
