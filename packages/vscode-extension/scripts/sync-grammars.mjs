/**
 * Materialize the canonical DarTsx TextMate grammars from @dartsx/language
 * into this extension's syntaxes/ directory.
 *
 * VS Code can only register grammars from files inside the extension folder
 * (contributes.grammars.path), so the extension ships build-time artifacts
 * of the single source of truth — the files in this directory are generated
 * and gitignored, never hand-maintained.
 *
 * Runs as a script (npm build) and as a vitest globalSetup so the grammar
 * snapshot tests work on a fresh checkout.
 */

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export default function syncGrammars() {
	const require = createRequire(import.meta.url);
	const languageEntry = require.resolve('@dartsx/language');
	const languageDir = dirname(dirname(languageEntry));
	const sourceDir = join(languageDir, 'syntaxes');
	const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'syntaxes');

	mkdirSync(outDir, { recursive: true });
	for (const name of readdirSync(sourceDir)) {
		if (name.endsWith('.tmLanguage.json')) {
			copyFileSync(join(sourceDir, name), join(outDir, name));
		}
	}
}

// Run when invoked directly (e.g. `node scripts/sync-grammars.mjs`)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	syncGrammars();
}