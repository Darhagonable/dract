import { defineConfig } from 'vite';
import dartsx from '@dartsx/vite-plugin';

export default defineConfig({
	plugins: [dartsx()],
});
