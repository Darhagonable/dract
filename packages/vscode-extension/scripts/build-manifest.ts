/**
 * Generates dist/package.json — the real, loadable VS Code extension
 * manifest — from the source package.json.
 *
 * The source manifest keeps contribution asset paths as npm package
 * specifiers (e.g. "@dartsx/language/syntaxes/foo.tmLanguage.json").
 * VS Code resolves `contributes` paths as extension-root-relative file
 * paths, so the specifier form is only meaningful to this build step:
 * each specifier is resolved through the package's exports map, the
 * asset is copied into dist/syntaxes/, and the emitted dist manifest
 * references it as "./syntaxes/foo.tmLanguage.json".
 *
 * dist/ as a whole is the loadable extension artifact (manifest +
 * main.cjs + server.cjs + browser.cjs + syntaxes/).
 *
 * Runs as part of `pnpm build` and as a vitest globalSetup.
 */

import { copyFileSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(scriptsDir, '..');
const distDir = join(packageDir, 'dist');

const require = createRequire(import.meta.url);

interface GrammarContribution {
	scopeName: string;
	path: string;
	[key: string]: unknown;
}

interface SourceManifest {
	name: string;
	main?: string;
	browser?: string;
	contributes?: { grammars?: GrammarContribution[]; [key: string]: unknown };
	[key: string]: unknown;
}

function isPackageSpecifier(p: string): boolean {
	return !p.startsWith('./') && !p.startsWith('../') && !p.startsWith('/');
}

/** Rewrite top-level entry points (main/browser) for dist-as-extension-root. */
function stripDistPrefix(p: string | undefined): string | undefined {
	if (typeof p !== 'string') return p;
	return p.replace(/^\.\/dist\//, './');
}

export default function buildDistManifest(): void {
	const source: SourceManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

	const grammars = (source.contributes?.grammars ?? []).map(grammar => {
		if (typeof grammar.path !== 'string' || !isPackageSpecifier(grammar.path)) {
			return grammar;
		}
		// Resolve through the owning package's exports map, copy the asset
		// into dist, and reference it relative to the dist extension root.
		const resolved = require.resolve(grammar.path);
		const name = basename(resolved);
		mkdirSync(join(distDir, 'syntaxes'), { recursive: true });
		copyFileSync(resolved, join(distDir, 'syntaxes', name));
		return { ...grammar, path: `./syntaxes/${name}` };
	});

	const manifest: SourceManifest = { ...source };
	manifest.main = stripDistPrefix(manifest.main);
	if (manifest.browser !== undefined) manifest.browser = stripDistPrefix(manifest.browser);
	if (grammars.length > 0) manifest.contributes = { ...manifest.contributes, grammars };
	delete manifest.scripts;
	delete manifest.devDependencies;
	delete manifest.private;
	writeFileSync(join(distDir, 'package.json'), JSON.stringify(manifest, null, '\t') + '\n');

	ensureScopedPackageLink();
}

/**
 * Dev/test hosts (vitest-environment-vscode, F5 on the package dir) load the
 * SOURCE manifest, whose grammar paths are npm-style specifiers. VS Code
 * resolves them as extension-root-relative paths, so expose the scoped
 * workspace packages at the extension root via a symlink into node_modules.
 * Never staged into the VSIX — packaging only consumes dist/.
 */
function ensureScopedPackageLink(): void {
	const link = join(packageDir, '@dartsx');
	if (lstatSync(link, { throwIfNoEntry: false })) return;
	symlinkSync('./node_modules/@dartsx', link, process.platform === 'win32' ? 'junction' : 'dir');
}

// Run when invoked directly (e.g. `node scripts/build-manifest.ts`)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	buildDistManifest();
}
