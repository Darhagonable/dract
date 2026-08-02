import { useState } from 'octane';

// Controlled inputs on NATIVE events: onInput fires per keystroke for text
// controls (there is no synthetic onChange layer), while selects and
// checkboxes use the platform's own change event.
export default function App() {
	const [name, setName] = useState('world');
	const [kind, setKind] = useState('plain');
	const [loud, setLoud] = useState(false);

	const greeting = () => {
		switch (kind) {
			case 'shout':
				return 'HELLO, ' + name.toUpperCase() + (loud ? '!!!' : '!');
			case 'whisper':
				return 'hello, ' + name.toLowerCase() + '…';
			default:
				return 'hello, ' + name;
		}
	};

	return (
		<div style={{ display: 'grid', gap: '0.75rem' }}>
			<div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
				<input value={name} onInput={(e) => setName(e.currentTarget.value)} />

				<select value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
					<option value="plain">plain</option>
					<option value="shout">shout</option>
					<option value="whisper">whisper</option>
				</select>

				<label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
					<input
						type="checkbox"
						checked={loud}
						onChange={(e) => setLoud(e.currentTarget.checked)}
					/>
					extra loud
				</label>
			</div>

			<div
				style={{
					padding: '0.75rem',
					border: '1px solid #8884',
					borderRadius: '8px',
					fontWeight: kind === 'shout' ? 700 : undefined,
					opacity: kind === 'whisper' ? 0.6 : undefined,
					fontStyle: kind === 'whisper' ? 'italic' : undefined,
				}}
			>
				<p style={{ margin: 0 }}>{greeting()}</p>
			</div>
		</div>
	);
}
