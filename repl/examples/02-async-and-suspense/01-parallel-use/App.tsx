import { useState, use, Suspense, ErrorBoundary } from 'octane';
import { fetchCity, fetchForecast } from './Data.tsx';

// Octane's parallel use(): provably-independent promises created for the
// same boundary START TOGETHER and the boundary suspends once — two 700ms
// fetches settle in ~700ms, not ~1400ms. React runs the same code as a
// serial waterfall.
function Dashboard(props: { attempt: number }) {
	const city = use(fetchCity(props.attempt));
	const forecast = use(fetchForecast(props.attempt));

	return (
		<>
			<p style={{ margin: 0 }}>{'City: ' + city}</p>
			<p style={{ margin: 0 }}>{'Forecast: ' + forecast}</p>
		</>
	);
}

function Elapsed(props: { since: number }) {
	const ms = Math.round(performance.now() - props.since);

	return (
		<p style={{ opacity: 0.6, margin: 0 }}>
			{'Both resolved after ~' + ms + 'ms — two 700ms fetches, one round.'}
		</p>
	);
}

export default function App() {
	const [attempt, setAttempt] = useState(1);
	const [startedAt, setStartedAt] = useState(() => performance.now());

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button
				onClick={() => {
					setStartedAt(performance.now());
					setAttempt(attempt + 1);
				}}
			>
				Reload both
			</button>

			<div style={{ padding: '0.75rem', border: '1px solid #8884', borderRadius: '8px' }}>
				<ErrorBoundary
					fallback={(error: Error) => <p style={{ color: '#ff5d72' }}>{error.message}</p>}
				>
					<Suspense fallback={<p style={{ opacity: 0.6, margin: 0 }}>loading both…</p>}>
						<Dashboard attempt={attempt} />
						<Elapsed since={startedAt} />
					</Suspense>
				</ErrorBoundary>
			</div>
		</div>
	);
}
