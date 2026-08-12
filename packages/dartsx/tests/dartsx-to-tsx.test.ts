/**
 * DarTsx-to-TSX snapshot test.
 *
 * Compares preprocess(input.tsx, { mode: 'typecheck' }) against output.tsx in the dartsx-to-tsx/ folder.
 * Run UPDATE_SNAPSHOTS=true to regenerate output.tsx from current output.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { preprocess } from '../src/compiler/phases/1-preprocess/index.js';

const DIR = join(__dirname, 'dartsx-to-tsx');
const UPDATE = !!process.env.UPDATE_SNAPSHOTS;

describe('dartsx-to-tsx', () => {
	it('snapshot', () => {
		const input = readFileSync(join(DIR, 'input.tsx'), 'utf-8');
		const { code } = preprocess(input.trim(), { mode: 'typecheck' });
		const actual = code.trimEnd() + '\n';

		const outputPath = join(DIR, 'output.tsx');

		if (UPDATE) {
			writeFileSync(outputPath, actual);
			return;
		}

		const expected = readFileSync(outputPath, 'utf-8');
		expect(actual).toBe(expected);
	});
});
