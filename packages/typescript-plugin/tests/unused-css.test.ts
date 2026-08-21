import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeUnusedCss } from 'unused-css';

const samplesDir = path.join(__dirname, 'unused-css', 'samples');

interface SampleConfig {
	warnings: Array<{
		selector: string;
		message?: string;
	}>;
}

const samples = fs.readdirSync(samplesDir).filter(name =>
	fs.statSync(path.join(samplesDir, name)).isDirectory()
);

describe('unused CSS detection', () => {
	for (const sample of samples) {
		it(sample, async () => {
			const sampleDir = path.join(samplesDir, sample);
			const input = fs.readFileSync(path.join(sampleDir, 'input.tsx'), 'utf-8');
			const config: SampleConfig = (await import(path.join(sampleDir, '_config.ts'))).default;

			const warnings = analyzeUnusedCss(input);
			const actualSelectors = warnings.map(w => w.selector);
			const expectedSelectors = config.warnings.map(w => w.selector);

			// Check we got exactly the expected warnings (order-independent)
			expect(actualSelectors.sort()).toEqual(expectedSelectors.sort());

			// Check message text if specified
			for (const expected of config.warnings) {
				if (expected.message) {
					const match = warnings.find(w => w.selector === expected.selector);
					expect(match).toBeDefined();
					expect(match!.message).toBe(expected.message);
				}
			}

			// Verify positions: each warning's start should point to the selector in the source
			for (const w of warnings) {
				const found = input.slice(w.start, w.start + w.length);
				expect(found).toBe(w.selector);
			}
		});
	}
});
