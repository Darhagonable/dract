// Client-side Prettier for the playground's Format button. Everything loads
// lazily on first use: `prettier/standalone` plus prettier's typescript and
// estree plugins for `.tsx` / `.react.tsx` files, and the babel plugin's json
// parser for `tsconfig.json`.
//
// Client-only: load via dynamic import from an event handler (never SSR).

// Mirrors the repo's .prettierrc (and the editor's tabSize: 2).
const OPTIONS = {
	useTabs: true,
	tabWidth: 2,
	singleQuote: true,
	printWidth: 100,
} as const;

export type FormatResult = { ok: true; code: string } | { ok: false; error: string };

/** Format one playground file. Never throws. */
export async function formatPlaygroundFile(name: string, source: string): Promise<FormatResult> {
	try {
		// estree is needed in BOTH branches: in the standalone build the core
		// format options (singleQuote, useTabs, …) are declared by the estree
		// plugin — without it they are silently dropped as unknown.
		const [{ format }, estree] = await Promise.all([
			import('prettier/standalone'),
			import('prettier/plugins/estree'),
		]);
		const typescript = await import('prettier/plugins/typescript');
		const babel = await import('prettier/plugins/babel');
		const isJson = name.endsWith('.json');
		const formatted = await format(source, {
			...OPTIONS,
			// The babel plugin ships the json/jsonc parsers (the dedicated
			// prettier/plugins/json module no longer exists in prettier 3.9).
			parser: isJson ? 'json' : 'typescript',
			plugins: [typescript, babel, estree],
		});
		return { ok: true, code: formatted };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
