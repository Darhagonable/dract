// The bundler: turns a workspace file set into the dependency-ordered module
// graph the sandbox executes. It consumes a Compiler (never oxc directly) for
// per-file artifacts, then rewrites import specifiers with es-module-lexer's
// exact offsets and topo-sorts the sibling graph so modules arrive at the
// sandbox dependencies-first.
//
// Specifier policy (the parent-side half of the sandbox security boundary —
// see the sandbox srcdoc generator for the sandbox that backs it):
//   ./File[.ext]        → sibling file, rewritten to a `__pg_module:<name>__`
//                         token the sandbox swaps for a blob URL
//   dartsx family       → left bare; the sandbox import map resolves them
//                         (dartsx → local runtime blobs)
//   https://esm.sh/*    → allowed verbatim; any other URL → error
//   any other bare id   → https://esm.sh/<id>?external=dartsx — `external`
//                         makes esm.sh leave `import 'dartsx'` bare so the
//                         import map pins bindings to the runtime singleton
import { moduleToken } from './runtime/sandbox-srcdoc.ts';
import { isTsconfigFile, TSCONFIG_FILE_NAME, type PlaygroundFile } from './types.ts';
import type { Compiler } from './compiler.ts';

export interface ModuleGraph {
	ok: true;
	entry: string;
	/** Dependency order — every module precedes its importers. */
	modules: { name: string; code: string }[];
	/** DarTsx emits no diagnostics yet — always empty. */
	warnings: { file: string; diagnostic: never }[];
	/**
	 * External packages the graph resolves through esm.sh (bare ids and verbatim
	 * URLs), as specifier → resolved URL — the input the
	 * TypeScript worker's type acquisition fetches declaration files from.
	 */
	externals: Record<string, string>;
}

export interface ModuleGraphFailure {
	ok: false;
	error: string;
}

/**
 * Parse the workspace's tsconfig.json, mirroring the Vue REPL's `getTsConfig`
 * contract: the raw parsed JSON, or null when the file is missing or malformed
 * (a broken config must never block the playground).
 */
export function parsePlaygroundTsconfig(
	files: readonly PlaygroundFile[],
): Record<string, unknown> | null {
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

/** Import specifiers the sandbox import map resolves — leave them bare. */
const IMPORT_MAP_SPECIFIERS = new Set([
	'dartsx',
	'dartsx/internal/client',
	'dartsx/jsx-runtime',
	'dartsx/jsx-dev-runtime',
]);

/** The esm.sh URL a bare specifier resolves through. */
function esmShUrlFor(specifier: string): string {
	return `https://esm.sh/${specifier}?external=dartsx`;
}

const SIBLING_EXTENSIONS = ['', '.tsx', '.ts'];

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
			// Left bare — the sandbox import map owns these.
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
 * Compile every file through the compiler and produce the rewritten,
 * dependency-ordered module graph for the sandbox. Never throws.
 */
export async function buildModuleGraph(
	compiler: Compiler,
	files: readonly PlaygroundFile[],
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

	await compiler.compile(files);

	const { init, parse } = await import('es-module-lexer');
	await init;

	const rewritten = new Map<string, string>();
	const siblingDeps = new Map<string, string[]>();
	const externals = new Map<string, string>();
	const warnings: ModuleGraph['warnings'] = [];

	for (const file of files) {
		try {
			if (isTsconfigFile(file.name)) {
				// Config files are workspace documents, not modules — nothing to
				// compile, rewrite, or execute.
				continue;
			}
			const output = compiler.outputFor(file.name);
			if (!output) {
				return {
					ok: false,
					error:
						compiler.errorFor(file.name) ??
						`${file.name}: not compiled — it contains no DarTsx syntax and no reactive calls target it.`,
				};
			}
			rewriteAndRecord(file.name, output.code, names, rewritten, siblingDeps, externals, parse);
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
		modules,
		warnings,
		externals: Object.fromEntries(externals),
	};
}
