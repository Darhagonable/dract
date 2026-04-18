import { defineConfig } from 'tsdown';
import { compile } from 'dartsx/compiler';

export default defineConfig({
	entry: ['src/index.ts'],
	format: 'esm',
	fixedExtension: false,
	dts: false,
	clean: true,
	outDir: 'dist',
	external: ['dartsx', 'dartsx/internal/client'],
	plugins: [
		{
			name: 'dartsx-compiler',
			transform(code, id) {
				if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return;
				// Only run compiler on files with DarTsx syntax
				const sample = code.slice(0, 4096);
				const hasDarTsx = /\bcomponent\s+\w+\s*\(/.test(sample)
					|| /\bstate\s+\w+\s*=/.test(sample)
					|| /\bderived\s+\w+\s*=/.test(sample);
				if (!hasDarTsx) return;

				const result = compile(code, { filename: id, css: 'injected' });
				return { code: result.code };
			},
		},
	],
});
