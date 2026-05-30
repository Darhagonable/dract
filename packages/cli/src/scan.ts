/**
 * File scanning and classification
 *
 * Scans input directory and classifies each file:
 * - .tsx files with DarTsx syntax → isDartsx: true, shipped as .tsx
 * - .ts files → transpiled to .js
 * - .d.ts files → copied as-is
 * - everything else → copied as-is
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDarTsxFile } from 'dartsx/preprocess';
import { posixify, walk } from './filesystem.js';
import type { PackageFile } from './types.js';

/**
 * Scan input directory and classify all files.
 */
export function scan(inputDir: string): PackageFile[] {
	const abs = walk(inputDir);
	return abs.map((file) => analyze(posixify(path.relative(inputDir, file)), inputDir));
}

/**
 * Classify a single file.
 */
export function analyze(relativePath: string, inputDir: string): PackageFile {
	const name = relativePath;

	if (name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.d.cts')) {
		return { name, dest: name, isDartsx: false, isDeclaration: true };
	}

	if (name.endsWith('.tsx')) {
		const fullPath = path.join(inputDir, name);
		const content = fs.readFileSync(fullPath, 'utf-8');
		if (isDarTsxFile(content)) {
			// DarTsx files ship as .tsx — consumer's vite plugin compiles them
			return { name, dest: name, isDartsx: true, isDeclaration: false };
		}
		// Regular TSX (no DarTsx syntax) → transpile to .jsx
		return { name, dest: name.replace(/\.tsx$/, '.jsx'), isDartsx: false, isDeclaration: false };
	}

	if (name.endsWith('.ts')) {
		const fullPath = path.join(inputDir, name);
		const content = fs.readFileSync(fullPath, 'utf-8');
		if (isDarTsxFile(content)) {
			// DarTsx .ts files ship as .ts — consumer's vite plugin compiles them
			return { name, dest: name, isDartsx: true, isDeclaration: false };
		}
		// .ts → .js
		return { name, dest: name.replace(/\.ts$/, '.js'), isDartsx: false, isDeclaration: false };
	}

	// .js, .json, .css, assets, etc. → copy as-is
	return { name, dest: name, isDartsx: false, isDeclaration: false };
}
