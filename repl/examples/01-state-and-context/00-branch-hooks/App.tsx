import { useState } from 'octane';

// Octane has no rules of hooks: hooks are keyed by call SITE, not call
// order, so useState may live inside an inline expression. The counter's
// state is bound to that call site, so it survives the branch collapsing —
// collapse and re-expand to watch it persist. (React cannot express this.)
export default function App() {
	const [open, setOpen] = useState(true);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button>

			{open ? (
				(() => {
					const [bumps, setBumps] = useState(0);

					return (
						<div
							style={{
								padding: '0.75rem',
								border: '1px solid #8884',
								borderRadius: '8px',
								display: 'grid',
								gap: '0.5rem',
								justifyItems: 'start',
							}}
						>
							<p style={{ margin: 0 }}>{'Branch-local bumps: ' + bumps}</p>
							<button onClick={() => setBumps(bumps + 1)}>Bump</button>
						</div>
					);
				})()
			) : (
				<p style={{ opacity: 0.6 }}>
					Collapsed — the counter keeps its state because its call site never moves.
				</p>
			)}
		</div>
	);
}
