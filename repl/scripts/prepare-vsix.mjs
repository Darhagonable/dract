// Copies the newest vscode-extension .vsix into the repl so the browser
// workbench can run the exact extension code VS Code runs (see main.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionDir = path.join(repoRoot, 'packages', 'vscode-extension');
// scripts/package.ts emits into out/; older layouts dropped the vsix in the
// package root — scan both so a stale artifact still gets picked up.
const searchDirs = [extensionDir, path.join(extensionDir, 'out')];
const dest = path.join(repoRoot, 'repl', 'dartsx.vsix');

const candidates = searchDirs.flatMap(dir => {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter(f => f.endsWith('.vsix'))
		.map(f => {
			const full = path.join(dir, f);
			return { full, mtime: fs.statSync(full).mtimeMs };
		});
}).sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) {
	console.error(`No .vsix found in ${extensionDir}. Run "pnpm --filter ./packages/vscode-extension run package" first.`);
	process.exit(1);
}

fs.copyFileSync(candidates[0].full, dest);
console.log(`Copied ${path.basename(candidates[0].full)} -> repl/dartsx.vsix`);
