/**
 * dartsx check — Type-check DarTsx projects and report unused CSS
 *
 * Uses @volar/typescript's proxyCreateProgram with the DarTsx language plugin
 * to type-check .tsx files containing DarTsx syntax. Also reports unused CSS
 * selectors in <style> blocks.
 */

import * as ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { proxyCreateProgram } from '@volar/typescript/lib/node/proxyCreateProgram.js';
import { getDarTsxLanguagePlugin } from '@dartsx/typescript-plugin/language';
import { analyzeUnusedCss } from '@dartsx/typescript-plugin/unused-css';
import { findSuppressZones, isDarTsxFile } from 'dartsx/compiler/preprocess';

// Errors always suppressed in DarTsx files — false positives from custom syntax transforms
// (mirrors ALWAYS_SUPPRESS in the TypeScript plugin)
const ALWAYS_SUPPRESS = new Set([
	1003, 1005, 1109, 1128, 1136, 1381, 1434,
	2304, 2362, 2552, 2632, 2657, 2693, 2695, 2724, 2809,
	6385, 7026,
]);

export interface CheckOptions {
	cwd?: string;
	tsconfig?: string;
}

export interface CheckResult {
	errors: number;
	warnings: number;
}

export function check(options: CheckOptions = {}): CheckResult {
	const cwd = options.cwd ?? process.cwd();
	const tsconfigPath = options.tsconfig
		? path.resolve(cwd, options.tsconfig)
		: ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');

	if (!tsconfigPath) {
		console.error('Could not find tsconfig.json');
		return { errors: 1, warnings: 0 };
	}

	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
	if (configFile.error) {
		const msg = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n');
		console.error(`Failed to read tsconfig: ${msg}`);
		return { errors: 1, warnings: 0 };
	}

	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		path.dirname(tsconfigPath),
	);

	// Create proxied program with DarTsx language plugin
	const proxied = proxyCreateProgram(
		ts,
		ts.createProgram,
		() => [getDarTsxLanguagePlugin()],
	);

	const host = ts.createCompilerHost(parsed.options);
	const program = proxied({
		rootNames: parsed.fileNames,
		options: parsed.options,
		host,
	});

	let errors = 0;
	let warnings = 0;

	// Collect TypeScript diagnostics
	const allDiagnostics = [
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
	];

	// Filter out suppressed diagnostics (control flow zones, bind attributes)
	const filteredDiagnostics = allDiagnostics.filter(d => {
		if (!d.file || d.start === undefined) return true;
		const source = d.file.text;
		if (!isDarTsxFile(source)) return true;
		// Always suppress known false positives from DarTsx syntax transforms
		if (ALWAYS_SUPPRESS.has(d.code)) return false;
		const zones = findSuppressZones(source);
		return !zones.some((z: { start: number; end: number }) => d.start! >= z.start && d.start! < z.end);
	});

	// Report TS errors
	if (filteredDiagnostics.length > 0) {
		const formatHost: ts.FormatDiagnosticsHost = {
			getCanonicalFileName: f => f,
			getCurrentDirectory: () => cwd,
			getNewLine: () => '\n',
		};
		const output = ts.formatDiagnosticsWithColorAndContext(filteredDiagnostics, formatHost);
		process.stdout.write(output);
		errors += filteredDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length;
		warnings += filteredDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Warning).length;
	}

	// Check unused CSS in DarTsx files
	for (const fileName of parsed.fileNames) {
		if (!fileName.endsWith('.tsx')) continue;
		const content = fs.readFileSync(fileName, 'utf-8');
		if (!isDarTsxFile(content)) continue;

		const cssWarnings = analyzeUnusedCss(content);
		if (cssWarnings.length > 0) {
			const relPath = path.relative(cwd, fileName);
			for (const w of cssWarnings) {
				// Find line/col from offset
				const lines = content.slice(0, w.start).split('\n');
				const line = lines.length;
				const col = lines[lines.length - 1].length + 1;
				console.log(`${relPath}(${line},${col}): warning: ${w.message}`);
				warnings++;
			}
		}
	}

	if (errors === 0 && warnings === 0) {
		console.log('No errors or warnings.');
	} else {
		console.log(`\n${errors} error(s), ${warnings} warning(s).`);
	}

	return { errors, warnings };
}
