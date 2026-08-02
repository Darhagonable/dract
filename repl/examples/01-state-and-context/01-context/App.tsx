import { createContext, use, useState } from 'octane';

const Theme = createContext('light');

function ThemeCard() {
	const theme = use(Theme);

	return (
		<div
			style={{
				padding: '0.75rem 1rem',
				borderRadius: '8px',
				border: '1px solid #8884',
				background: theme === 'dark' ? '#101318' : '#f6f2ea',
				color: theme === 'dark' ? '#f4eee8' : '#1c1b18',
			}}
		>
			<p>{'The current theme is ' + theme + '.'}</p>
		</div>
	);
}

export default function App() {
	const [theme, setTheme] = useState('light');

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
				Switch theme
			</button>

			<Theme.Provider value={theme}>
				<ThemeCard />
			</Theme.Provider>

			<ThemeCard />
			<p style={{ opacity: 0.6 }}>
				The second card sits outside the provider, so it sees the fallback.
			</p>
		</div>
	);
}
