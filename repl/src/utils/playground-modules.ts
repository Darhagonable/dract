// Turns the playground's virtual files into the module graph the sandbox
// executes: compiles each file (the Project for `.tsx`/`.ts`, sucrase's
// react-jsx transform for `.react.tsx` React-host files), rewrites import
// specifiers with es-module-lexer's exact offsets, and topo-sorts the sibling
// graph so modules arrive at the sandbox dependencies-first.
//
// The Project instance lives at module scope: it OWNS the cross-file graph
// (reactive exports, call contributions, incremental invalidation), so the
// preview — unlike a per-file compile — gets genuinely reactive imported
// state, and each edit recompiles exactly what it invalidates. It is pure
// JS/WASM (oxc-parser + oxc-transform wasm bindings + esrap printer, no Node
// APIs), so it runs in the browser exactly as it does in the Vite plugin.
//
// Specifier policy (the parent-side half of the sandbox security boundary —
// see playground-sandbox.ts for the sandbox that backs it):
//   ./File[.ext]        → sibling file, rewritten to a `__pg_module:<name>__`
//                         token the sandbox swaps for a blob URL
//   dartsx family       → left bare; the sandbox import map resolves them
//                         (dartsx → local runtime blobs)
//   react family        → left bare; the sandbox import map resolves them
//                         to esm.sh (React-host files only)
//   https://esm.sh/*    → allowed verbatim; any other URL → error
//   any other bare id   → https://esm.sh/<id>?external=dartsx — `external`
//                         makes esm.sh leave `import 'dartsx'` bare so the
//                         import map pins bindings to the runtime singleton
//
// Client-only: load via dynamic import from an effect (never during SSR).
import { Project, type ModuleOutput } from 'dartsx/compiler';
import { moduleToken, PLAYGROUND_REACT_VERSION } from './playground-sandbox.ts';

export interface PlaygroundFile {
	name: string;
	source: string;
}

/**
 * The workspace's tsconfig file (Vue-REPL style): a plain virtual file the
 * visitor can edit. Nothing consumes its options yet — the editor has no
 * language service and the compiler is a syntax transform — but the file is
 * the agreed surface for compiler options once a type-checking or emit layer
 * lands.
 */
export const TSCONFIG_FILE_NAME = 'tsconfig.json';

export function isTsconfigFile(name: string): boolean {
	return name === TSCONFIG_FILE_NAME;
}

/**
 * Parse the workspace's tsconfig.json, mirroring the Vue REPL's `getTsConfig`
 * contract: the raw parsed JSON, or null when the file is missing or malformed
 * (a broken config must never block the playground).
 */
export function parsePlaygroundTsconfig(files: PlaygroundFile[]): Record<string, unknown> | null {
	const file = files.find((candidate) => candidate.name === TSCONFIG_FILE_NAME);
	if (!file) return null;
	try {
		const parsed: unknown = JSON.parse(file.source);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export interface ModuleGraph {
	ok: true;
	entry: string;
	entryKind: 'dartsx' | 'react';
	/** Dependency order — every module precedes its importers. */
	modules: { name: string; code: string }[];
	/** DarTsx emits no diagnostics yet — always empty. */
	warnings: { file: string; diagnostic: never }[];
	/**
	 * External packages the graph resolves through esm.sh (bare ids, verbatim
	 * URLs, and the react family), as specifier → resolved URL — the input the
	 * TypeScript worker's type acquisition fetches declaration files from.
	 */
	externals: Record<string, string>;
}

export interface ModuleGraphFailure {
	ok: false;
	error: string;
}

// ── Project ───────────────────────────────────────────────────────────────
// The Project is the single source of truth for every `.tsx`/`.ts` file:
// it recompiles incrementally (an edit invalidates exactly the files whose
// inputs it changes) and hands each module's output — code, source map, and
// the printed AST — to both the graph builder and the compiled pane. The
// host resolves sibling imports and reads sources from the live workspace
// file set; everything else (esm.sh URLs, bare ids) stays unresolved — the
// same contract as the old `resolveExternal: () => null`.
/** The workspace file set the project host reads from (synced per compile). */
let currentFiles = new Map<string, PlaygroundFile>();
let currentFileNames = new Set<string>();
/** File names the project knows about, for remove() diffs. */
const projectFiles = new Set<string>();
/** Last compile error per file — `update` throws; errors surface per file. */
const compileErrors = new Map<string, string>();

const project = new Project({
	css: 'injected',
	entryPoints: [],
	host: {
		resolve: (specifier) => {
			if (!specifier.startsWith('./')) return undefined;
			const resolved = resolveSibling(specifier, currentFileNames);
			return resolved && !isReactHostFile(resolved) ? resolved : undefined;
		},
		readFile: (id) => currentFiles.get(id)?.source,
	},
});

/** Bring the project up to date with the workspace's `.tsx`/`.ts` files. */
async function ensureCompiled(files: PlaygroundFile[]): Promise<void> {
	currentFiles = new Map(files.map((f) => [f.name, f]));
	currentFileNames = new Set(currentFiles.keys());

	for (const name of [...projectFiles]) {
		if (currentFiles.has(name)) continue;
		project.remove(name);
		projectFiles.delete(name);
		compileErrors.delete(name);
	}
	for (const file of files) {
		if (isReactHostFile(file.name) || isTsconfigFile(file.name)) continue;
		projectFiles.add(file.name);
	}

	// Compile the workspace, then recompile whatever the project reports as
	// invalidated: a module's inputs (a caller's reactive-call contributions,
	// an importer's reactive exports) can change under it mid-pass, so its
	// first output may be stale. Each pass recompiles only the invalidated
	// files; the graph converges when a pass invalidates nothing.
	let worklist = [...projectFiles];
	while (worklist.length > 0) {
		const next: string[] = [];
		for (const name of worklist) {
			const file = currentFiles.get(name);
			if (!file) continue;
			try {
				const { invalidated } = await project.update(name, file.source);
				compileErrors.delete(name);
				for (const id of invalidated) {
					if (projectFiles.has(id) && !next.includes(id)) next.push(id);
				}
			} catch (error) {
				compileErrors.set(name, error instanceof Error ? error.message : String(error));
			}
		}
		worklist = next;
	}
}

/**
 * The project's output for one file, or null when it has none. Files whose
 * last compile threw return null too — the project keeps the previous output
 * around, but the pane must show the error, not stale code.
 */
export function getModuleOutput(name: string): ModuleOutput | null {
	if (compileErrors.has(name)) return null;
	return project.output(name);
}

/** The last compile error for one file, or null when it compiled or was never tried. */
export function compileError(name: string): string | null {
	return compileErrors.get(name) ?? null;
}

/** Import specifiers the sandbox import map resolves — leave them bare. */
const IMPORT_MAP_SPECIFIERS = new Set([
	'dartsx',
	'dartsx/internal/client',
	'dartsx/jsx-runtime',
	'dartsx/jsx-dev-runtime',
	'react',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	'react-dom',
	'react-dom/client',
]);

/** File-kind helpers — `.react.tsx` marks a React-host file (see D1/plan). */
export function isReactHostFile(name: string): boolean {
	return name.endsWith('.react.tsx');
}

/**
 * The esm.sh URL a bare specifier resolves through (the sandbox import map
 * pins the react family to the workspace catalog's REACT_VERSION so every
 * entry shares one build — mirror that here so acquired types match what
 * actually executes).
 */
function esmShUrlFor(specifier: string): string {
	const reactPin = (pkg: string, rest: string) =>
		`https://esm.sh/${pkg}@${PLAYGROUND_REACT_VERSION}${rest}?external=dartsx`;
	if (specifier === 'react' || specifier.startsWith('react/')) {
		return reactPin('react', specifier.slice('react'.length));
	}
	if (specifier === 'react-dom' || specifier.startsWith('react-dom/')) {
		return reactPin('react-dom', specifier.slice('react-dom'.length));
	}
	return `https://esm.sh/${specifier}?external=dartsx`;
}

const SIBLING_EXTENSIONS = ['', '.tsx', '.react.tsx', '.ts'];

// React-host files bypass the Project: sucrase strips types and
// applies the automatic react-jsx transform (no type-checking — this is a
// demo surface, not a toolchain). Memoized per (name, source) since it has no
// incremental layer of its own.
const sucraseCache = new Map<string, { source: string; result: CachedCompile }>();
type CachedCompile = { ok: true; code: string; warnings: never[] } | { ok: false; error: string };

async function compileReactHostFile(file: PlaygroundFile): Promise<CachedCompile> {
	const cached = sucraseCache.get(file.name);
	if (cached && cached.source === file.source) return cached.result;
	let result: CachedCompile;
	try {
		const { transform } = await import('sucrase');
		const out = transform(file.source, {
			transforms: ['typescript', 'jsx'],
			jsxRuntime: 'automatic',
			jsxImportSource: 'react',
			production: true,
		});
		result = { ok: true, code: out.code, warnings: [] };
	} catch (error) {
		result = {
			ok: false,
			error: `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	sucraseCache.set(file.name, { source: file.source, result });
	return result;
}

/**
 * The memoized compile for one React-host file, if the graph already produced
 * it for this exact source. The compiled-output pane uses it to show
 * `.react.tsx` files — the Project cannot compile them at all (they
 * are Sucrase's), and recompiling them a second time just for the pane would
 * duplicate the work `buildModuleGraph` has already done. Never compiles; a
 * miss means the next graph build fills it.
 */
export function peekCompiledFile(file: PlaygroundFile): CachedCompile | null {
	const cached = sucraseCache.get(file.name);
	return cached && cached.source === file.source ? cached.result : null;
}

/** Resolve `./Name[.ext]` against the file set, with extension inference. */
function resolveSibling(specifier: string, names: Set<string>): string | null {
	const base = specifier.slice(2);
	for (const ext of SIBLING_EXTENSIONS) {
		if (names.has(base + ext)) return base + ext;
	}
	return null;
}

/** Rewrite one compiled module's specifiers and record its sibling deps. */
function rewriteAndRecord(
	name: string,
	code: string,
	names: Set<string>,
	rewritten: Map<string, string>,
	siblingDeps: Map<string, string[]>,
	externals: Map<string, string>,
	parse: typeof import('es-module-lexer').parse,
): void {
	let imports;
	try {
		[imports] = parse(code, name);
	} catch (error) {
		throw new Error(
			`${name}: could not parse compiled output for imports (${
				error instanceof Error ? error.message : String(error)
			})`,
		);
	}

	// Rewrite specifiers back-to-front so earlier offsets stay valid.
	const deps: string[] = [];
	for (let i = imports.length - 1; i >= 0; i--) {
		const record = imports[i];
		// `n` is the decoded specifier for static and simple dynamic imports;
		// undefined for computed dynamic imports like import(someVar) — those
		// resolve at runtime in the sandbox.
		const specifier = record.n;
		if (specifier === undefined || record.s < 0) continue;
		// Static import spans exclude the quotes; dynamic import spans (d > -1)
		// include them — requote when splicing a dynamic specifier.
		const dynamic = record.d > -1;
		const replaceWith = (value: string) => {
			const spliced = dynamic ? JSON.stringify(value) : value;
			code = code.slice(0, record.s) + spliced + code.slice(record.e);
		};

		if (specifier.startsWith('./')) {
			const resolved = resolveSibling(specifier, names);
			if (!resolved) {
				throw new Error(`${name}: "${specifier}" does not match any playground file.`);
			}
			if (!deps.includes(resolved)) deps.push(resolved);
			replaceWith(moduleToken(resolved));
		} else if (specifier.startsWith('../') || specifier.startsWith('/')) {
			throw new Error(`${name}: "${specifier}" — only sibling "./File" imports are supported.`);
		} else if (IMPORT_MAP_SPECIFIERS.has(specifier)) {
			// Left bare — the sandbox import map owns these. The react family
			// resolves to esm.sh there; record the resolved URL so the TypeScript
			// worker can acquire types for it too.
			if (specifier.startsWith('react')) {
				externals.set(specifier, esmShUrlFor(specifier));
			}
		} else if (specifier.startsWith('dartsx/')) {
			throw new Error(
				`${name}: "${specifier}" is not available in the playground (only "dartsx" and its runtime subpaths are).`,
			);
		} else if (specifier.startsWith('https://esm.sh/')) {
			// Already an esm.sh URL — allowed verbatim.
			externals.set(specifier, specifier);
		} else if (/^(https?:)?\/\//.test(specifier) || specifier.includes(':')) {
			throw new Error(
				`${name}: "${specifier}" — only https://esm.sh/ URLs are supported for URL imports.`,
			);
		} else {
			const url = esmShUrlFor(specifier);
			externals.set(specifier, url);
			replaceWith(url);
		}
	}
	rewritten.set(name, code);
	siblingDeps.set(name, deps);
}

/**
 * Compile every file and produce the rewritten, dependency-ordered module
 * graph for the sandbox. Never throws.
 */
export async function buildModuleGraph(
	files: PlaygroundFile[],
	entry: string,
): Promise<ModuleGraph | ModuleGraphFailure> {
	if (!files.some((f) => f.name === entry)) {
		return { ok: false, error: `Entry file "${entry}" does not exist.` };
	}
	if (isTsconfigFile(entry)) {
		return {
			ok: false,
			error: `"${TSCONFIG_FILE_NAME}" is a config file — pick a .tsx/.ts source file as the entry.`,
		};
	}
	const names = new Set(files.map((f) => f.name));
	if (names.size !== files.length) {
		return { ok: false, error: 'Playground file names must be unique.' };
	}

	await ensureCompiled(files);

	const { init, parse } = await import('es-module-lexer');
	await init;

	const rewritten = new Map<string, string>();
	const siblingDeps = new Map<string, string[]>();
	const externals = new Map<string, string>();
	const warnings: ModuleGraph['warnings'] = [];

	for (const file of files) {
		try {
			if (isReactHostFile(file.name)) {
				const out = await compileReactHostFile(file);
				if (!out.ok) return { ok: false, error: out.error };
				for (const diagnostic of out.warnings) warnings.push({ file: file.name, diagnostic });
				rewriteAndRecord(file.name, out.code, names, rewritten, siblingDeps, externals, parse);
				continue;
			}
			if (isTsconfigFile(file.name)) {
				// Config files are workspace documents, not modules — nothing to
				// compile, rewrite, or execute.
				continue;
			}
			const output = getModuleOutput(file.name);
			if (!output) {
				return {
					ok: false,
					error:
						compileError(file.name) ??
						`${file.name}: not compiled — it contains no DarTsx syntax and no reactive calls target it.`,
				};
			}
			rewriteAndRecord(file.name, output.js.code, names, rewritten, siblingDeps, externals, parse);
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	// Topo-sort the sibling graph (DFS from the entry; unreferenced files are
	// appended afterwards so their compile errors/warnings still surface).
	const order: string[] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	let cycle: string[] | null = null;
	const visit = (name: string, chain: string[]) => {
		if (cycle || state.get(name) === 'done') return;
		if (state.get(name) === 'visiting') {
			cycle = [...chain.slice(chain.indexOf(name)), name];
			return;
		}
		state.set(name, 'visiting');
		for (const dep of siblingDeps.get(name) ?? []) visit(dep, [...chain, name]);
		state.set(name, 'done');
		order.push(name);
	};
	visit(entry, []);
	for (const file of files) {
		// Config files are not modules — unreferenced and unexecutable.
		if (!isTsconfigFile(file.name)) visit(file.name, []);
	}
	if (cycle) {
		return {
			ok: false,
			error: `Circular imports between playground files are not supported: ${(cycle as string[]).join(' → ')}.`,
		};
	}
	// DFS post-order IS dependencies-first — the only ordering the sandbox
	// needs (it looks the entry up by name, not position).
	const modules = order.map((name) => ({ name, code: rewritten.get(name)! }));

	return {
		ok: true,
		entry,
		entryKind: isReactHostFile(entry) ? 'react' : 'dartsx',
		modules,
		warnings,
		externals: Object.fromEntries(externals),
	};
}
