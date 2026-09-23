import './theme.css';
import { mount } from 'dartsx';

// Theme contract: 'dartsx-theme' in localStorage ↔ <html data-theme>.
// theme.css already renders the right palette for the system preference
// with zero JS; main.ts only needs to apply a stored override and serve
// the toggle button.
const THEME_STORAGE_KEY = 'dartsx-theme';

function applyTheme(theme: 'light' | 'dark') {
	document.documentElement.setAttribute('data-theme', theme);
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', theme === 'light' ? '#ffffff' : '#23272f');
}

let stored: string | null = null;
try {
	stored = localStorage.getItem(THEME_STORAGE_KEY);
} catch {}
applyTheme(
	stored === 'light' || stored === 'dark'
		? stored
		: window.matchMedia('(prefers-color-scheme: light)').matches
			? 'light'
			: 'dark',
);

const toggle = document.createElement('button');
toggle.id = 'repl-theme-toggle';
toggle.textContent = 'Toggle theme';
toggle.onclick = () => {
	const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
	try {
		localStorage.setItem(THEME_STORAGE_KEY, next);
	} catch {}
	applyTheme(next);
};
document.body.prepend(toggle);

// The App graph pulls in monaco + the workers; importing it dynamically
// keeps the theme and toggle ahead of that heavy module graph.
import('./App').then(({ default: App }) => {
	mount(App, document.querySelector('app-root')!);
});
