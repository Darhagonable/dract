import { createElement, createRoot } from 'octane';
import { Playground } from './pages/playground/Playground.tsrx';

// Theme toggle for the standalone repl (the site's lives in its header).
// Keeps the same 'octane-theme' key + data-theme contract as the inline
// THEME_INIT script in index.html.
const toggle = document.createElement('button');
toggle.id = 'repl-theme-toggle';
toggle.textContent = 'Toggle theme';
toggle.onclick = () => {
	const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
	try {
		localStorage.setItem('octane-theme', next);
	} catch {}
	document.documentElement.setAttribute('data-theme', next);
};
document.body.prepend(toggle);

createRoot(document.getElementById('__app')!).render(createElement(Playground));
