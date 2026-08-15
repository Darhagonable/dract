/**
 * Snapshot test runner for the DarTsx compiler.
 *
 * Each subdirectory under `samples/` is a test case containing one or more
 * `.ts`/`.tsx` source files. Every test is driven through the compiler's
 * standalone `Project` layer with cross-module tracking. Outputs land in
 * `_expected/<name>.js`.
 *
 * Run `UPDATE_SNAPSHOTS=true pnpm test` to regenerate `_expected/`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import { Project } from '../../src/compiler/project';

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

/** Drive the Project across multiple files with cross-module tracking. */
async function compileMultiFile(dir: string, files: string[]): Promise<Map<string, string>> {
	const filePaths = new Map(files.map(f => [f, join(dir, f)]));

	const project = new Project({
		entryPoints: [...filePaths.values()],
		host: {
			resolve: async (specifier) => {
				if (!specifier.startsWith('./')) return undefined;
				const base = specifier.slice(2);
				for (const [name, abs] of filePaths) {
					if (base === name || base === name.replace(/\.[^.]+$/, '')) return abs;
				}
				return undefined;
			},
			readFile: (id) => (existsSync(id) ? readFileSync(id, 'utf-8') : undefined),
		},
	});

	// Discover and compile the whole graph from the entry points, following
	// stale ids until the reactive information converges.
	await project.init();

	const outputs = new Map<string, string>();
	for (const filename of files) {
		const abs = filePaths.get(filename)!;
		const output = project.output(abs);
		if (output) {
			outputs.set(filename.replace(/\.[^.]+$/, '.js'), output.code);
		}
	}

	return outputs;
}

describe('compiler snapshots', () => {
	for (const name of samples) {
		const dir = join(SAMPLES_DIR, name);
		const files = readdirSync(dir)
			.filter(f => /\.(tsx?|jsx?)$/.test(f))
			.sort();
		if (files.length === 0) continue;

		it(name, async () => {
			const outputs = await compileMultiFile(dir, files);
			assertOutputs(dir, outputs);
		});
	}
});