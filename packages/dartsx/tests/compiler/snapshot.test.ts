/**
 * Snapshot test runner for the DarTsx compiler.
 *
 * Each subdirectory under `samples/` is a test case containing one or more
 * `.ts`/`.tsx` source files. Every test is driven through the real Vite plugin
 * with cross-module tracking. Outputs land in `_expected/<name>.js`.
 *
 * Run `UPDATE_SNAPSHOTS=true pnpm test` to regenerate `_expected/`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import dartsx, { type DarTsxTransformContext } from '@dartsx/vite-plugin';

const SAMPLES_DIR = join(__dirname, 'samples');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

/** Plugin hooks are plain functions at runtime; Vite's ObjectHook type just doesn't expose `.call`. */
function hookCall(hook: object, ctx: unknown, ...args: unknown[]): unknown {
	return (hook as (...args: unknown[]) => unknown).call(ctx, ...args);
}

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

/** Drive the real Vite plugin across multiple files with cross-module tracking. */
async function compileMultiFile(dir: string, files: string[]): Promise<Map<string, string>> {
	const plugin = dartsx();
	const filePaths = new Map(files.map(f => [f, join(dir, f)]));

	const ctx: DarTsxTransformContext = {
		async resolve(specifier: string) {
			if (!specifier.startsWith('./')) return null;
			const base = specifier.slice(2);
			for (const [name, abs] of filePaths) {
				if (base === name || base === name.replace(/\.[^.]+$/, '')) return { id: abs };
			}
			return null;
		},
		error(msg: string) { throw new Error(msg); },
		environment: null,
	};

	const outputs = new Map<string, string>();

	// Two passes: first builds the registry, second picks up cross-file info
	for (let pass = 0; pass < 2; pass++) {
		for (const filename of files) {
			const abs = filePaths.get(filename)!;
			const result = await hookCall(plugin.transform!, ctx, readFileSync(abs, 'utf-8'), abs) as
				| { code: string }
				| undefined;
			if (result && typeof result === 'object' && 'code' in result) {
				outputs.set(filename.replace(/\.[^.]+$/, '.js'), result.code);
			} else if (pass === 0) {
				outputs.set(filename.replace(/\.[^.]+$/, '.js'), readFileSync(abs, 'utf-8'));
			}
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
