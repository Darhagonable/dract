/**
 * Preprocessor snapshot tests.
 *
 * preprocess(input.tsx) must equal output.tsx, preprocess(input.jsx) must
 * equal output.jsx — the same lowering logic for every fixture extension in
 * the preprocessor/ folder. Run UPDATE_SNAPSHOTS=true to regenerate the
 * output files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { preprocess } from '../../src/compiler/phases/1-preprocess/index.js';

const DIR = join(__dirname, 'preprocessor');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

describe('preprocessor', () => {
	it('preprocess tsx', () => {
		const input = readFileSync(join(DIR, 'input.tsx'), 'utf-8');
		const { code } = preprocess(input.trim(), { filename: 'input.tsx' });
		const actual = code.trimEnd() + '\n';

		const outputPath = join(DIR, 'output.tsx');

		if (UPDATE) {
			writeFileSync(outputPath, actual);
			return;
		}

		const expected = readFileSync(outputPath, 'utf-8');
		expect(actual).toBe(expected);
	});

	it('preprocess jsx', () => {
		const input = readFileSync(join(DIR, 'input.jsx'), 'utf-8');
		const { code } = preprocess(input.trim(), { filename: 'input.jsx' });
		const actual = code.trimEnd() + '\n';

		const outputPath = join(DIR, 'output.jsx');

		if (UPDATE) {
			writeFileSync(outputPath, actual);
			return;
		}

		const expected = readFileSync(outputPath, 'utf-8');
		expect(actual).toBe(expected);
	});
});
