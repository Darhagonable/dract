/**
 * Snapshot test runner for the DarTsx compiler.
 *
 * Each subdirectory under `samples/` is a test case containing one or more
 * `.ts`/`.tsx` source files. Every test is driven through the ProjectCompiler
 * with cross-module tracking. Outputs land in `_expected/<name>.js`.
 *
 * Run `UPDATE_SNAPSHOTS=true pnpm test` to regenerate `_expected/`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import { ProjectCompiler } from '../../src/compiler/index';

const SAMPLES_DIR = join(__dirname, 'samples');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

const samples = readdirSync(SAMPLES_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort();

/** Write outputs, optionally update expected, then compare. */
function assertOutputs(dir: string, outputs: Map<string, string>) {
	const outputDir = join(dir, '_output');
	const expectedDir = join(dir, '_expected');
	mkdirSync(outputDir, { recursive: true });

	for (const [name, code] of outputs) {
		writeFileSync(join(outputDir, name), code);
	}

	if (UPDATE) {
		rmSync(expectedDir, { recursive: true, force: true });
		cpSync(outputDir, expectedDir, { recursive: true });
		return;
	}

	if (!existsSync(expectedDir)) {
		throw new Error(`No _expected/ directory. Run UPDATE_SNAPSHOTS=true pnpm test to generate.`);
	}

	for (const [name] of outputs) {
		const actual = readFileSync(join(outputDir, name), 'utf-8').trimEnd();
		const expected = readFileSync(join(expectedDir, name), 'utf-8').trimEnd();
		expect(actual, `Mismatch: ${name}`).toBe(expected);
	}
}

/** Drive the ProjectCompiler across multiple files with cross-module tracking. */
function compileMultiFile(dir: string, files: string[]): Map<string, string> {
	const project = new ProjectCompiler();
	for (const filename of files) {
		project.addFile(filename, readFileSync(join(dir, filename), 'utf-8'));
	}
	const outputs = project.compileAll();

	const result = new Map<string, string>();
	for (const filename of files) {
		const output = outputs.get(filename);
		if (output) result.set(filename.replace(/\.[^.]+$/, '.js'), output.js.code);
	}
	return result;
}

describe('compiler snapshots', () => {
	for (const name of samples) {
		const dir = join(SAMPLES_DIR, name);
		const files = readdirSync(dir)
			.filter(f => /\.(tsx?|jsx?)$/.test(f))
			.sort();
		if (files.length === 0) continue;

		it(name, () => {
			const outputs = compileMultiFile(dir, files);
			assertOutputs(dir, outputs);
		});
	}
});
