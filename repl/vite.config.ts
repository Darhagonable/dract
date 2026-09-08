import { defineConfig, type Plugin } from 'vite';
import dartsx from '@dartsx/vite-plugin';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { build as esbuildBuild } from 'esbuild';

// Serves /playground-runtime.json: the dartsx runtime as ONE self-contained
// ESM shim exporting both surfaces — `export * from 'dartsx'` plus the
// internal client's default `$`. The preview iframe is sandboxed to an
// opaque origin: it cannot fetch parent-origin URLs (CORS) or share the
// parent's module instances, so the parent passes this code over and the
// iframe turns it into a blob module. Both 'dartsx' and
// 'dartsx/internal/client' map to the same blob — a single module instance,
// so signal/context singletons hold by construction.
const RUNTIME_PATH = '/playground-runtime.json';

function playgroundRuntime(): Plugin {
	async function bundle(): Promise<string> {
		const require = createRequire(import.meta.url);
		const out = await esbuildBuild({
			stdin: {
				contents: "export * from 'dartsx'; export { default } from 'dartsx/internal/client';",
				resolveDir: path.dirname(require.resolve('dartsx')),
				loader: 'ts',
			},
			bundle: true,
			format: 'esm',
			minify: true,
			write: false,
			platform: 'browser',
			define: { 'process.env.NODE_ENV': JSON.stringify('production') },
		});
		return JSON.stringify({ code: out.outputFiles[0].text });
	}

	return {
		name: 'dartsx-playground-runtime',
		configureServer(server) {
			// Rebuilt per request (~15ms): dev never serves a stale runtime
			// after workspace dartsx rebuilds.
			server.middlewares.use(RUNTIME_PATH, (_req, res, next) => {
				bundle().then(
					(code) => {
						res.setHeader('Content-Type', 'application/json; charset=utf-8');
						res.end(code);
					},
					next,
				);
			});
		},
		async generateBundle() {
			if (this.environment.name !== 'client') return;
			this.emitFile({ type: 'asset', fileName: RUNTIME_PATH.slice(1), source: await bundle() });
		},
	};
}

// Serves /dartsx-lang-fs.json for the language worker's virtual FS (see
// src/language/virtual-fs.ts): TypeScript's default libs and the dartsx
// runtime's .d.ts files as a path → text JSON map — dev middleware plus
// build asset. import.meta.glob can't do this (node_modules is ignored)
// and virtual modules don't reach vite's worker sub-builds, so the worker
// fetches this JSON at boot.
const LANG_FS_PATH = '/dartsx-lang-fs.json';

function languageTypesFs(): Plugin {
	let cache: string | null = null;

	function collect(): string {
		if (cache !== null) return cache;
		const require = createRequire(import.meta.url);
		const files: Record<string, string> = {};

		// Exports maps hide ./package.json, so resolve a real entry and walk up.
		const tsLibDir = path.dirname(require.resolve('typescript'));
		for (const name of readdirSync(tsLibDir)) {
			if (/^lib[^/]*\.d\.ts$/.test(name)) {
				files[`/node_modules/typescript/lib/${name}`] = readFileSync(path.join(tsLibDir, name), 'utf8');
			}
		}

		// pnpm symlinks the workspace dep: repl/node_modules/dartsx → the
		// built package, whose dist/** d.ts is exactly what a project
		// importing 'dartsx' should resolve.
		const dartsxRoot = path.resolve(path.dirname(require.resolve('dartsx')), '../../..');
		files['/node_modules/dartsx/package.json'] = readFileSync(path.join(dartsxRoot, 'package.json'), 'utf8');
		for (const name of readdirSync(path.join(dartsxRoot, 'dist'), { recursive: true })) {
			const rel = typeof name === 'string' ? name : name.join('/');
			if (rel.endsWith('.d.ts') || rel.endsWith('.d.mts')) {
				files[`/node_modules/dartsx/dist/${rel.replaceAll('\\', '/')}`] = readFileSync(
					path.join(dartsxRoot, 'dist', ...rel.split(/[\\/]/)),
					'utf8',
				);
			}
		}

		cache = JSON.stringify(files);
		return cache;
	}

	return {
		name: 'dartsx-language-types-fs',
		configureServer(server) {
			server.middlewares.use(LANG_FS_PATH, (_req, res, next) => {
				res.setHeader('Content-Type', 'application/json; charset=utf-8');
				res.end(collect());
			});
		},
		generateBundle() {
			if (this.environment.name !== 'client') return;
			this.emitFile({
				type: 'asset',
				fileName: LANG_FS_PATH.slice(1),
				source: collect(),
			});
		},
	};
}

// Verification runs isolate their optimizer cache (see the optimizeDeps
// note) so they can never corrupt a live dev server's shared cache.
const VERIFY = process.env.PLAYGROUND_VERIFY === '1';

export default defineConfig({
	cacheDir: VERIFY ? 'node_modules/.vite-verify' : undefined,
	plugins: [dartsx(), languageTypesFs(), playgroundRuntime()],
	worker: {
		format: 'es',
	},
	server: {
		// The oxc wasm bindings are wasip1-threads builds: posting the shared
		// wasm memory to their worker pool requires cross-origin isolation.
		// require-corp (not credentialless — Firefox doesn't support it) is
		// safe here: every subresource is same-origin or a blob URL, both
		// exempt from CORP.
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
		// Pre-transform the heavy module graphs (both workers + the app) so
		// the first browser request doesn't race on-demand transforms — an
		// empty worker response on a cold server kills the language layer
		// for the whole session without the boot retry.
		warmup: {
			clientFiles: [
				'./src/main.ts',
				'./src/compiler/compiler.worker.ts',
				'./src/language/dartsx.worker.ts',
			],
		},
	},
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
	build: {
		target: 'esnext',
	},
	optimizeDeps: {
		// NOTE: concurrent vite servers share node_modules/.vite with NO
		// cross-server locking — a second server with --force (or deleting
		// the dir) under a live server serves URLs into vanished chunks,
		// surfacing as empty worker sources. Verification servers must run
		// with an isolated cache: `vite --cacheDir node_modules/.vite-verify`.
		//
		// These ship CommonJS; raw CJS has no named ESM exports, so they are
		// prebundled to ESM — for both the main thread and worker sub-builds.
		include: [
			'typescript',
			'@dartsx/language-service',
			'@volar/language-service',
			'@volar/typescript',
			'@volar/monaco',
			'volar-service-typescript/lib/plugins/semantic',
			'volar-service-typescript/lib/plugins/directiveComment',
			'esrap',
			'esrap/languages/tsx',
			'@jridgewell/remapping',
			'postcss',
			'postcss-selector-parser',
		],
		// The oxc toolchain resolves through browser fields to WASM bindings
		// (fetched .wasm assets + a nested worker) — prebundling breaks those
		// asset URLs, so this slice stays raw for the compiler worker.
		exclude: [
			'oxc-parser',
			'oxc-transform',
			'@oxc-parser/binding-wasm32-wasi',
			'@oxc-transform/binding-wasm32-wasi',
			'@napi-rs/wasm-runtime',
		],
	},
});
