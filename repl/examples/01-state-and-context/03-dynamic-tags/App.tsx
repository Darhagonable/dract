import { useState } from 'octane';

// Rendering a component chosen from a table through a variable. Swapping
// the variable remounts just that slot's subtree — the parent never
// re-renders.
function Red(props: { label: string }) {
	return (
		<span
			style={{
				padding: '0.35rem 0.75rem',
				borderRadius: '6px',
				background: '#fee2e2',
				color: '#991b1b',
			}}
		>
			{'red: ' + props.label}
		</span>
	);
}

function Blue(props: { label: string }) {
	return (
		<span
			style={{
				padding: '0.35rem 0.75rem',
				borderRadius: '6px',
				background: '#dbeafe',
				color: '#1e40af',
			}}
		>
			{'blue: ' + props.label}
		</span>
	);
}

function Green(props: { label: string }) {
	return (
		<span
			style={{
				padding: '0.35rem 0.75rem',
				borderRadius: '6px',
				background: '#d1fae5',
				color: '#065f46',
			}}
		>
			{'green: ' + props.label}
		</span>
	);
}

const CHIPS = { red: Red, blue: Blue, green: Green };

export default function App() {
	const [which, setWhich] = useState<keyof typeof CHIPS>('red');
	const Chip = CHIPS[which];

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={() => setWhich('red')}>red</button>
				<button onClick={() => setWhich('blue')}>blue</button>
				<button onClick={() => setWhich('green')}>green</button>
			</div>

			<div style={{ padding: '0.75rem', border: '1px solid #8884', borderRadius: '8px' }}>
				<Chip label="live swap" />
			</div>
		</div>
	);
}
