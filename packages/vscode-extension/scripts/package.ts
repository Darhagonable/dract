#!/usr/bin/env node
/**
 * Packages the DarTsx VS Code extension into a .vsix without ever mutating
 * the real package.json: stage dist/, README.md and the built language
 * service (as node_modules, shared with tsserver) into out/vsix/, generate
 * the VSIX manifest there, run vsce, remove the staging dir.
 */

import { createVSIX } from '@vscode/vsce';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const languageServiceDir = resolve(packageDir, '../language-service');
const stageDir = join(packageDir, 'out', 'vsix');
const outDir = join(packageDir, 'out');

const VSCODE_EXTENSION_NAME = 'vscode-extension';

function createVsixManifest(manifest: { name: string; dependencies?: Record<string, string>; [key: string]: unknown }): Record<string, unknown> {
	const {
		name: _npmName,
		private: _private,
		scripts: _scripts,
		devDependencies: _devDependencies,
		dependencies: _dependencies,
		...extensionManifest
	} = manifest;

	extensionManifest.name = VSCODE_EXTENSION_NAME; // vsce rejects scoped names
	extensionManifest.files = ['dist/**', 'README.md', 'node_modules/**'];
	return extensionManifest;
}

/** Stage the built language service as a node module — tsserver resolves its plugin entry (dist/plugin) and the grammars (syntaxes/) from here. */
function stageLanguageService() {
	const { name } = JSON.parse(readFileSync(join(languageServiceDir, 'package.json'), 'utf8'));
	const moduleDir = join(stageDir, 'node_modules', ...name.split('/'));
	mkdirSync(join(moduleDir, 'dist'), { recursive: true });
	cpSync(join(languageServiceDir, 'dist'), join(moduleDir, 'dist'), { recursive: true });
	cpSync(join(languageServiceDir, 'syntaxes'), join(moduleDir, 'syntaxes'), { recursive: true });
	writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name, main: 'dist/index.js' }, null, '\t'));
}

async function main() {
	const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
	const version = manifest.version;

	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(join(stageDir, 'node_modules'), { recursive: true });
	for (const entry of ['dist', 'README.md']) {
		if (!statSync(join(packageDir, entry), { throwIfNoEntry: false })) {
			throw new Error(`Missing ${entry}. Run \`pnpm build\` first.`);
		}
		symlinkSync(relative(stageDir, join(packageDir, entry)), join(stageDir, entry), entry === 'dist' ? 'dir' : 'file');
	}
	stageLanguageService();

	writeFileSync(join(stageDir, 'package.json'), JSON.stringify(createVsixManifest(manifest), null, '\t'));
	readdirSync(outDir).filter(f => f.endsWith('.vsix')).forEach(f => rmSync(join(outDir, f)));

	await createVSIX({
		cwd: stageDir,
		packagePath: join(outDir, `dartsx-${version}.vsix`),
		updatePackageJson: false,
		gitTagVersion: false,
		followSymlinks: true,
		allowMissingRepository: true,
	});

	rmSync(stageDir, { recursive: true, force: true });
	console.log(`Packaged ${manifest.publisher}.${VSCODE_EXTENSION_NAME} v${version} -> out/dartsx-${version}.vsix`);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
