/**
 * Integration test: exercises the full Volar + TypeScript pipeline
 * using proxyCreateProgram, the same mechanism used by `runTsc` and
 * the TS language service plugin. This catches crashes that unit-level
 * dartsxToTsx tests cannot (e.g., invalid virtual code, bad mappings,
 * files discovered via module resolution).
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { proxyCreateProgram } from '@volar/typescript/lib/node/proxyCreateProgram';
import { getDarTsxLanguagePlugin } from '../src/language';

const ROOT = path.resolve(__dirname, '../../..');

/**
 * Create a proxied ts.createProgram that runs files through the
 * DarTsx Volar language plugin (same as the real plugin does).
 */
function createDarTsxProgram(tsconfigPath: string) {
	const proxied = proxyCreateProgram(
		ts,
		ts.createProgram,
		() => [getDarTsxLanguagePlugin({ readFileSync: (filePath) => fs.readFileSync(filePath, 'utf-8') })],
	);

	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (configFile.error) {
		throw new Error(`Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
	}

	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		path.dirname(tsconfigPath),
	);

	const host = ts.createCompilerHost(parsed.options);

	const program = proxied({
		rootNames: parsed.fileNames,
		options: parsed.options,
		host,
	});

	return program;
}

describe('Volar integration (proxyCreateProgram)', () => {

	describe('test fixtures', () => {
		const fixturesTsconfig = path.join(__dirname, 'fixtures', 'tsconfig.json');

		it('createProgram does not crash', () => {
			const program = createDarTsxProgram(fixturesTsconfig);
			expect(program).toBeDefined();
			expect(program.getSourceFiles().length).toBeGreaterThan(0);
		});

		it('getSyntacticDiagnostics returns no errors for DarTsx files', () => {
			const program = createDarTsxProgram(fixturesTsconfig);
			const dartsxFiles = program.getSourceFiles().filter(
				sf => sf.fileName.includes('fixtures') && !sf.fileName.endsWith('.d.ts'),
			);
			expect(dartsxFiles.length).toBeGreaterThan(0);

			for (const sf of dartsxFiles) {
				const diags = program.getSyntacticDiagnostics(sf);
				const messages = diags.map(d =>
					`${sf.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
				);
				expect(messages).toEqual([]);
			}
		});

		it('getSemanticDiagnostics does not crash', () => {
			const program = createDarTsxProgram(fixturesTsconfig);
			// Just calling this should not throw
			expect(() => {
				program.getSemanticDiagnostics();
			}).not.toThrow();
		});

		it('plain .ts files are not transformed by Volar', () => {
			const program = createDarTsxProgram(fixturesTsconfig);
			const plainFile = program.getSourceFiles().find(sf => sf.fileName.endsWith('plain.ts'));
			expect(plainFile).toBeDefined();
			// plain.ts has no DarTsx syntax - its content should be unchanged
			expect(plainFile!.text).toContain('export function helper');
		});

		it('regular React .tsx files are not transformed', () => {
			const program = createDarTsxProgram(fixturesTsconfig);
			const regularFile = program.getSourceFiles().find(sf => sf.fileName.endsWith('Regular.tsx'));
			expect(regularFile).toBeDefined();
			// Regular.tsx uses standard React - should not be claimed by DarTsx plugin
			expect(regularFile!.text).toContain('React.useState');
		});
	});

	describe('playground project', () => {
		const playgroundTsconfig = path.join(ROOT, 'playground', 'tsconfig.json');

		it('createProgram does not crash', () => {
			const program = createDarTsxProgram(playgroundTsconfig);
			expect(program).toBeDefined();
			expect(program.getSourceFiles().length).toBeGreaterThan(0);
		});

		it('getSyntacticDiagnostics returns no errors', () => {
			const program = createDarTsxProgram(playgroundTsconfig);
			const projectFiles = program.getSourceFiles().filter(
				sf => sf.fileName.includes('playground/src'),
			);
			expect(projectFiles.length).toBeGreaterThan(0);

			for (const sf of projectFiles) {
				const diags = program.getSyntacticDiagnostics(sf);
				const messages = diags.map(d =>
					`${path.relative(ROOT, sf.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
				);
				expect(messages).toEqual([]);
			}
		});

		it('getSemanticDiagnostics does not crash', () => {
			const program = createDarTsxProgram(playgroundTsconfig);
			expect(() => {
				program.getSemanticDiagnostics();
			}).not.toThrow();
		});
	});
});
