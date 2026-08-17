import { defineConfig, type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { build as esbuildBuild } from 'esbuild';

// The playground executes user code in a sandboxed iframe with an OPAQUE
// origin (src/utils/playground-sandbox.ts). That iframe can't import the site's
// bundled dartsx (blob URLs are origin-bound and cross-origin module fetches
// need CORS), so the parent hands it the runtime as TEXT and the iframe turns
// it into blob modules on its own side of the boundary.
//
// The runtime ships as a JSON MANIFEST of esbuild code-split chunks rather
// than one file: `dartsx` (the external runtime the examples import —
// effect/mount/context etc.) and `dartsx/internal/client` (what compiled
// modules import as `$`) are separate entries sharing the dartsx core through
// common chunks (bundling either standalone would duplicate the core — two
// runtimes, broken signal/context singletons). React itself stays EXTERNAL:
// the sandbox's import map resolves the react family to esm.sh, so react is
// only ever fetched when user code actually imports it (React-host `.react.tsx`
// entries) — pure-dartsx sessions never touch the network.
function playgroundRuntime(): Plugin {
	const MANIFEST_PATH = '/playground-runtime.json'; // = RUNTIME_MANIFEST_PATH in playground-sandbox.ts

	async function bundle(): Promise<string> {
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
			external: [
				'react',
				'react-dom',
				'react-dom/client',
				'react/jsx-runtime',
				'react/jsx-dev-runtime',
			],
			define: { 'process.env.NODE_ENV': JSON.stringify('production') },
		});

		const files: Record<string, string> = {};
		for (const file of out.outputFiles) {
			files[file.path.replace(/^.*[/\\]/, '')] = file.text;
		}

		// The sandbox creates a blob URL per file and splices it into the files
		// that import it, so files must arrive dependencies-first. Topo-sort the
		// chunk graph (esbuild inter-chunk specifiers are exactly `./<name>.mjs`).
		const deps = new Map<string, string[]>();
		for (const [name, code] of Object.entries(files)) {
			const imported: string[] = [];
			for (const match of code.matchAll(/(["'])\.\/([\w.-]+\.mjs)\1/g)) {
				if (files[match[2]] && !imported.includes(match[2])) imported.push(match[2]);
			}
			deps.set(name, imported);
		}
		const order: string[] = [];
		const state = new Map<string, 'visiting' | 'done'>();
		const visit = (name: string, chain: string[]) => {
			if (state.get(name) === 'done') return;
			if (state.get(name) === 'visiting') {
				throw new Error(
					`playground runtime chunks import each other cyclically (${[...chain, name].join(' → ')}) — the sandbox's dependencies-first blob ordering cannot represent that`,
				);
			}
			state.set(name, 'visiting');
			for (const dep of deps.get(name) ?? []) visit(dep, [...chain, name]);
			state.set(name, 'done');
			order.push(name);
		};
		for (const name of deps.keys()) visit(name, []);

		return JSON.stringify({
			entries: { dartsx: 'dartsx.mjs', 'dartsx/internal/client': 'dartsx-internal-client.mjs' },
			order,
			files,
		});
	}

	return {
		name: 'dartsx-playground-runtime',
		configureServer(server) {
			server.middlewares.use(MANIFEST_PATH, (_req, res, next) => {
				// Rebuilt per request — esbuild bundles the runtime in ~15ms, and
				// this way dev never serves a stale runtime after dartsx edits.
				bundle().then((code) => {
					res.setHeader('Content-Type', 'application/json; charset=utf-8');
					res.end(code);
				}, next);
			});
		},
		async generateBundle() {
			if (this.environment.name !== 'client') return;
			this.emitFile({
				type: 'asset',
				fileName: MANIFEST_PATH.slice(1),
				source: await bundle(),
			});
		},
	};
}

// Dependencies the scanner cannot reach (the playground's dynamic imports and
// the dartsx compiler's transitive deps — dartsx itself is excluded below)
// are pre-declared so no optimize pass runs mid-session.
const PREBUNDLED = [
	'@codemirror/commands',
	'@codemirror/state',
	'@codemirror/view',
	'shiki',
	'esrap',
	'esrap/languages/tsx',
	'es-module-lexer',
	'sucrase',
	'prettier/standalone',
	'prettier/plugins/typescript',
	'prettier/plugins/estree',
];

export default defineConfig({
	plugins: [playgroundRuntime()],

	optimizeDeps: {
		// The dartsx compiler resolves oxc-parser/oxc-transform through their
		// browser fields to WASM bindings (fetched .wasm assets + a worker), so
		// those packages — and the bindings themselves — must reach the browser
		// raw instead of being esbuild-prebundled. dartsx is excluded with them
		// so the whole compiler graph keeps its browser resolution.
		exclude: [
			'dartsx',
			'oxc-parser',
			'oxc-transform',
			'@oxc-parser/binding-wasm32-wasi',
			'@oxc-transform/binding-wasm32-wasi',
			'@napi-rs/wasm-runtime',
		],
		include: PREBUNDLED,
	},

	build: {
		target: 'esnext',
	},
});
