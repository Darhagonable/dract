import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { build as esbuildBuild } from 'esbuild';
import type { RuntimeManifest } from './src/utils/playground-sandbox.ts';

async function buildManifest(): Promise<RuntimeManifest> {
	const require = createRequire(import.meta.url);
	const out = await esbuildBuild({
		entryPoints: {
			dartsx: require.resolve('dartsx'),
			'dartsx-internal-client': require.resolve('dartsx/internal/client'),
		},
		bundle: true,
		splitting: true,
		format: 'esm',
		minify: true,
		write: false,
		outdir: 'playground-runtime',
		entryNames: '[name]',
		chunkNames: 'chunk-[hash]',
		outExtension: { '.js': '.mjs' },
		define: { 'process.env.NODE_ENV': JSON.stringify('production') },
	});

	const files: Record<string, string> = {};
	for (const file of out.outputFiles) {
		files[file.path.replace(/^.*[/\\]/, '')] = file.text;
	}
	return {
		entries: {
			dartsx: 'dartsx.mjs',
			'dartsx/internal/client': 'dartsx-internal-client.mjs',
		},
		files,
	};
}

function playgroundRuntime(): Plugin {
	const virtualId = 'virtual:dartsx-runtime-manifest';
	const resolvedVirtualId = '\0' + virtualId;
	let cached: Promise<RuntimeManifest> | null = null;

	return {
		name: 'dartsx-playground-runtime',
		resolveId(id) {
			if (id === virtualId) return resolvedVirtualId;
		},
		load(id) {
			if (id !== resolvedVirtualId) return;
			cached ??= buildManifest();
			return cached.then((manifest) => `export default ${JSON.stringify(manifest)}`);
		},
	};
}

export default defineConfig({
	plugins: [react(), playgroundRuntime()],
	optimizeDeps: {
		exclude: [
			'dartsx',
			'oxc-parser',
			'oxc-transform',
			'@oxc-parser/binding-wasm32-wasi',
			'@oxc-transform/binding-wasm32-wasi',
			'@napi-rs/wasm-runtime',
		],
		include: [
			'esrap',
			'esrap/languages/tsx',
			'es-module-lexer',
			'prettier/standalone',
			'prettier/plugins/typescript',
			'prettier/plugins/estree',
			'@dartsx/language-service',
		],
	},
});
