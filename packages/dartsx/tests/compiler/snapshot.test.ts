/**
 * Snapshot test runner for the DarTsx compiler.
 *
 * Each subdirectory under `samples/` is a test case containing:
 *   - `input.tsx`       — DarTsx source to compile
 *   - `_config.json`    — (optional) CompileOptions
 *   - `_expected/`      — checked-in expected compiler output
 *     └── `output.js`
 *   - `_output/`        — generated at test time (gitignored), compared against `_expected/`
 *     └── `output.js`
 *
 * Run `UPDATE_SNAPSHOTS=true pnpm test` to regenerate `_expected/` from `_output/`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import { compile } from '../../src/compiler';

const SAMPLES_DIR = join(__dirname, 'samples');

const samples = readdirSync(SAMPLES_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort();

describe('compiler snapshots', () => {
	for (const name of samples) {
		const dir = join(SAMPLES_DIR, name);
		const inputFile = join(dir, 'input.tsx');

		if (!existsSync(inputFile)) continue;

		it(name, () => {
			const source = readFileSync(inputFile, 'utf-8');

			// Load optional compile options
			const configFile = join(dir, '_config.json');
			const options = existsSync(configFile)
				? JSON.parse(readFileSync(configFile, 'utf-8'))
				: {};

			// Compile
			const result = compile(source, options);

			// Write _output/
			const outputDir = join(dir, '_output');
			mkdirSync(outputDir, { recursive: true });
			writeFileSync(join(outputDir, 'output.js'), result.code);

			// Update mode: copy _output → _expected
			if (process.env.UPDATE_SNAPSHOTS) {
				rmSync(join(dir, '_expected'), { recursive: true, force: true });
				cpSync(outputDir, join(dir, '_expected'), { recursive: true });
				return;
			}

			// Compare
			const expectedDir = join(dir, '_expected');
			if (!existsSync(expectedDir)) {
				throw new Error(
					`No _expected/ directory for "${name}". Run UPDATE_SNAPSHOTS=true pnpm test to generate.`,
				);
			}

			const actual = readFileSync(join(outputDir, 'output.js'), 'utf-8').trimEnd();
			const expected = readFileSync(join(expectedDir, 'output.js'), 'utf-8').trimEnd();

			expect(actual).toBe(expected);
		});
	}
});
