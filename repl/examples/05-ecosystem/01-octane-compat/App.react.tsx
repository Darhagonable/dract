import { useState } from 'react';
import { OctaneCompat } from 'octane/react';
import { Island } from './Island.tsx';

// This file is a REACT host — real react-dom (from esm.sh) renders it.
// <OctaneCompat> mounts the compiled Octane island inside the React tree;
// events inside the island are native and bubble through to React
// ancestors, and the island runs its own Suspense boundary.
export default function App() {
	const [mounted, setMounted] = useState(true);
	const [hostClicks, setHostClicks] = useState(0);

	return (
		<main
			style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}
			onClick={() => setHostClicks((clicks) => clicks + 1)}
		>
			<h2 style={{ margin: 0 }}>React 19 host</h2>
			<p style={{ margin: 0, opacity: 0.7 }}>
				{'Clicks seen by the React host (bubbled from anywhere below): ' + hostClicks}
			</p>

			<button onClick={() => setMounted((value) => !value)}>
				{mounted ? 'Unmount island' : 'Mount island'}
			</button>

			{mounted ? (
				<OctaneCompat>
					<Island start={3} />
				</OctaneCompat>
			) : null}
		</main>
	);
}
