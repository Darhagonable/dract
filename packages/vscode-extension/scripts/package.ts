#!/usr/bin/env node
/**
 * Packages the DarTsx VS Code extension into a .vsix without ever mutating
 * the real package.json.
 *
 * Flow:
 *   1. Read the real package.json in memory
 *   2. Rewrite the identity for the VSIX (name: "vscode-extension" -> dartsx.vscode-extension)
 *      and strip npm-only fields vsce rejects or doesn't need
 *   3. Stage artifacts into out/vsix/ (symlinks to dist/, syntaxes/, README.md)
 *   4. Write the generated manifest as out/vsix/package.json — the only file written
 *   5. Run @vscode/vsce's createVSIX against the staging directory
 *   6. Remove the staging directory — only the .vsix remains in out/
 */

import { createVSIX } from '@vscode/vsce';
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = join(packageDir, 'out', 'vsix');
// the .vsix is emitted next to the staging dir, NOT inside dist/ — dist is
// symlinked into the stage, so writing there would make the vsix visible
// inside out/vsix/ too
const outDir = join(packageDir, 'out');

const VSCODE_EXTENSION_NAME = 'vscode-extension';

interface PackageManifest {
	name: string;
	publisher: string;
	version: string;
	dependencies?: Record<string, string>;
	[key: string]: unknown;
}

function readManifest(): PackageManifest {
	return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
}

function createVsixManifest(manifest: PackageManifest): Record<string, unknown> {
	const {
		// npm-only fields that must not leak into the VSIX manifest
		name: _npmName,
		private: _private,
		scripts: _scripts,
		devDependencies: _devDependencies,
		...extensionManifest
	} = manifest;

	extensionManifest.name = VSCODE_EXTENSION_NAME;
	// the staging directory only contains what we stage — declare it so vsce
	// doesn't warn about a missing .vscodeignore
	extensionManifest.files = ['dist/**', 'syntaxes/**', 'README.md'];
	// workspace:* protocol deps are bundled at build time; drop them so the
	// generated manifest stays valid on its own
	delete extensionManifest.dependencies?.['@dartsx/typescript-plugin'];

	return extensionManifest;
}

const STAGED_ENTRIES = [
	'dist',
	'syntaxes',
	'README.md',
];

function stageArtifacts() {
	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	for (const entry of STAGED_ENTRIES) {
		const source = join(packageDir, entry);
		if (!statSync(source, { throwIfNoEntry: false })) {
			throw new Error(`Missing artifact required for packaging: ${entry}. Run \`pnpm build\` first.`);
		}
		symlinkSync(relative(stageDir, source), join(stageDir, entry), 'dir');
	}
}

async function main() {
	const manifest = readManifest();
	const version = manifest.version;

	stageArtifacts();

	const vsixManifest = createVsixManifest(manifest);
	writeFileSync(join(stageDir, 'package.json'), JSON.stringify(vsixManifest, null, '\t'));

	readdirSync(outDir).filter(f => f.endsWith('.vsix')).forEach(f => rmSync(join(outDir, f)));

	await createVSIX({
		cwd: stageDir,
		packagePath: join(outDir, `dartsx-${version}.vsix`),
		dependencies: false,
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
