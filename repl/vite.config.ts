import { defineConfig, type Plugin } from 'vite';
import dartsx from '@dartsx/vite-plugin';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

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

export default defineConfig({
	plugins: [dartsx(), languageTypesFs()],
	worker: {
		format: 'es',
	},
	build: {
		target: 'esnext',
	},
	optimizeDeps: {
		// These ship CommonJS; raw CJS has no named ESM exports, so they are
		// prebundled to ESM — for both the main thread and the worker sub-build.
		include: [
			'typescript',
			'@dartsx/language-service',
			'@volar/language-service',
			'@volar/typescript',
			'@volar/monaco',
			'volar-service-typescript/lib/plugins/semantic',
			'volar-service-typescript/lib/plugins/directiveComment',
		],
	},
});
