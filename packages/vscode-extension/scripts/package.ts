#!/usr/bin/env node
/**
 * Packages the DarTsx VS Code extension into a .vsix without ever mutating
 * any checked-in file.
 *
 * Flow:
 *   1. Read dist/package.json — the generated, loadable extension manifest
 *      (from scripts/build-manifest.ts). It is authoritative: its grammar
 *      paths and entry points already point at real files inside dist/.
 *   2. Rewrite the identity for the VSIX (name -> vscode-extension), map
 *      dist-root-relative paths ("./main.cjs", "./syntaxes/...") to the
 *      VSIX layout ("./dist/main.cjs", "./dist/syntaxes/..."), strip
 *      npm-only fields, and declare the tsserver plugin dependency
 *   3. Stage artifacts into out/vsix/:
 *      - dist/ and README.md (symlinks)
 *      - node_modules/@dartsx/typescript-plugin/ — the tsserver plugin as a
 *        self-contained package (generated package.json + bundled dist/index.js).
 *        VS Code resolves the typescriptServerPlugins contribution against the
 *        extension's node_modules, so the plugin must physically ship in the VSIX.
 *   4. Write the generated manifest as out/vsix/package.json
 *   5. Run @vscode/vsce's createVSIX against the staging directory (npm mode:
 *      vsce collects node_modules via `npm list --production`, so the staged
 *      plugin must be a valid installed package matching the manifest deps)
 *   6. Verify the .vsix contains the plugin and grammars, then remove the
 *      staging directory — only the .vsix remains in out/
 */

import { createVSIX } from '@vscode/vsce';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = join(packageDir, 'out', 'vsix');
// the .vsix is emitted next to the staging dir, NOT inside dist/ — dist is
// symlinked into the stage, so writing there would make the vsix visible
// inside out/vsix/ too
const outDir = join(packageDir, 'out');

const pluginDir = join(packageDir, '..', 'typescript-plugin');

const VSCODE_EXTENSION_NAME = 'vscode-extension';
const PLUGIN_PACKAGE = '@dartsx/typescript-plugin';

interface PackageManifest {
	name: string;
	publisher: string;
	version: string;
	dependencies?: Record<string, string>;
	[key: string]: unknown;
}

function readDistManifest(): PackageManifest {
	const distManifestPath = join(packageDir, 'dist', 'package.json');
	if (!statSync(distManifestPath, { throwIfNoEntry: false })) {
		throw new Error(`Missing ${relative(packageDir, distManifestPath)} — run \`pnpm build\` first (it generates the dist manifest).`);
	}
	return JSON.parse(readFileSync(distManifestPath, 'utf8'));
}

/** Map a dist-root-relative path to its location in the staged VSIX layout. */
function reprefixDistPath(p: unknown): unknown {
	if (typeof p !== 'string' || !p.startsWith('./')) return p;
	return `./dist/${p.slice(2)}`;
}

function createVsixManifest(distManifest: PackageManifest): Record<string, unknown> {
	const {
		// npm-only fields that must not leak into the VSIX manifest
		name: _npmName,
		scripts: _scripts,
		devDependencies: _devDependencies,
		private: _private,
		...extensionManifest
	} = JSON.parse(JSON.stringify(distManifest)) as PackageManifest;

	extensionManifest.name = VSCODE_EXTENSION_NAME;

	// dist is staged as a subdirectory of the extension: map entry points
	// and contribution asset paths from dist-root-relative to VSIX-relative
	extensionManifest.main = reprefixDistPath(extensionManifest.main);
	if (extensionManifest.browser !== undefined) {
		extensionManifest.browser = reprefixDistPath(extensionManifest.browser);
	}
	const contributes = extensionManifest.contributes as { grammars?: { path?: unknown }[] } | undefined;
	if (contributes?.grammars) {
		contributes.grammars = contributes.grammars.map(g => ({ ...g, path: reprefixDistPath(g.path) }));
	}

	// the staging directory only contains what we stage — declare it so vsce
	// doesn't warn about a missing .vscodeignore
	extensionManifest.files = ['dist/**', 'README.md', `node_modules/${PLUGIN_PACKAGE}/**`];

	// Runtime dependencies of the VSIX: everything is bundled into dist/
	// (server.cjs inlines @dartsx/language and @volar/*) except the tsserver
	// plugin, which ships as a self-contained staged package (see stagePlugin)
	// and is declared with a plain version range so vsce's node_modules <->
	// deps matching passes.
	extensionManifest.dependencies = { [PLUGIN_PACKAGE]: '*' };

	return extensionManifest;
}

function stageDirEntry(entry: string) {
	const source = join(packageDir, entry);
	if (!statSync(source, { throwIfNoEntry: false })) {
		throw new Error(`Missing artifact required for packaging: ${entry}. Run \`pnpm build\` first.`);
	}
	symlinkSync(relative(stageDir, source), join(stageDir, entry), 'dir');
}

/**
 * Stage the tsserver plugin as node_modules/@dartsx/typescript-plugin:
 * a generated package.json plus the plugin's self-contained bundle. tsserver
 * requires() the package by name from the extension's node_modules, exactly
 * like VS Code's typescriptServerPlugins resolution expects.
 */
function stagePlugin() {
	const bundle = join(pluginDir, 'dist', 'index.js');
	if (!statSync(bundle, { throwIfNoEntry: false })) {
		throw new Error(`Missing plugin bundle: ${relative(packageDir, bundle)}. Run \`pnpm build\` for @dartsx/typescript-plugin first.`);
	}

	const pluginManifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
	const stagedPackageDir = join(stageDir, 'node_modules', PLUGIN_PACKAGE);
	mkdirSync(join(stagedPackageDir, 'dist'), { recursive: true });

	writeFileSync(join(stagedPackageDir, 'package.json'), JSON.stringify({
		name: pluginManifest.name,
		version: pluginManifest.version,
		main: './dist/index.js',
	}, null, '\t'));
	copyFileSync(bundle, join(stagedPackageDir, 'dist', 'index.js'));
}

function stageArtifacts() {
	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	stageDirEntry('dist');
	stageDirEntry('README.md');
	stagePlugin();
}

// ── VSIX verification ──────────────────────────────────────────────

/**
 * List the file names inside a .zip (VSIX) by reading its central
 * directory — no unzip dependency needed.
 */
function listZipEntries(zipPath: string): string[] {
	const buf = readFileSync(zipPath);

	// Find the End Of Central Directory record (scan backwards — the zip
	// may have a trailing comment of up to 64 KiB)
	const EOCD_SIG = 0x06054b50;
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIG) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) throw new Error('Not a zip file: no end of central directory record');

	const entryCount = buf.readUInt16LE(eocd + 10);
	let offset = buf.readUInt32LE(eocd + 16);

	const names: string[] = [];
	const CD_SIG = 0x02014b50;
	for (let i = 0; i < entryCount; i++) {
		if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_SIG) break;
		const nameLen = buf.readUInt16LE(offset + 28);
		const extraLen = buf.readUInt16LE(offset + 30);
		const commentLen = buf.readUInt16LE(offset + 32);
		names.push(buf.toString('utf8', offset + 46, offset + 46 + nameLen));
		offset += 46 + nameLen + extraLen + commentLen;
	}
	return names;
}

function verifyVsix(vsixPath: string) {
	const entries = listZipEntries(vsixPath);
	const required = [
		'extension/dist/main.cjs',
		'extension/dist/server.cjs',
		`extension/node_modules/${PLUGIN_PACKAGE}/package.json`,
		`extension/node_modules/${PLUGIN_PACKAGE}/dist/index.js`,
		'extension/dist/syntaxes/dartsx.css-expressions.injection.tmLanguage.json',
		'extension/dist/syntaxes/dartsx.render.injection.tmLanguage.json',
		'extension/dist/syntaxes/dartsx.style.injection.tmLanguage.json',
	];
	const missing = required.filter(name => !entries.includes(name));
	if (missing.length > 0) {
		throw new Error(`VSIX verification failed — missing entries:\n  ${missing.join('\n  ')}\nPackaged entries:\n  ${entries.join('\n  ')}`);
	}
}

async function main() {
	const manifest = readDistManifest();
	const version = manifest.version;

	stageArtifacts();

	const vsixManifest = createVsixManifest(manifest);
	writeFileSync(join(stageDir, 'package.json'), JSON.stringify(vsixManifest, null, '\t'));

	readdirSync(outDir).filter(f => f.endsWith('.vsix')).forEach(f => rmSync(join(outDir, f)));

	const vsixPath = join(outDir, `dartsx-${version}.vsix`);
	await createVSIX({
		cwd: stageDir,
		packagePath: vsixPath,
		updatePackageJson: false,
		gitTagVersion: false,
		followSymlinks: true,
		allowMissingRepository: true,
	});

	verifyVsix(vsixPath);

	rmSync(stageDir, { recursive: true, force: true });

	console.log(`Packaged ${manifest.publisher}.${VSCODE_EXTENSION_NAME} v${version} -> out/dartsx-${version}.vsix`);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
