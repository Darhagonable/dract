import { defineConfig } from 'vite';
import dartsx from '@dartsx/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import markdown from './plugins/markdown';

export default defineConfig({
	plugins: [tailwindcss(), dartsx(), markdown()],
});
