/**
 * Diagnostic suppression for DarTsx files.
 *
 * DarTsx source is lowered to TypeScript for the service view, which
 * produces false-positive diagnostics. This module suppresses known
 * artifacts while leaving ordinary TypeScript errors visible.
 *
 * Shared between the tsserver plugin (src/index.ts) and `dartsx check`
 * (@dartsx/cli), which drives the same filtering programmatically.
 */

import { isDarTsxFile, findSuppressZones, type SuppressZone } from 'dartsx/compiler/preprocess';
import { analyzeUnusedCss, DARTSX_UNUSED_CSS_CODE } from './unused-css';

// Errors always suppressed in DarTsx files (syntax errors from custom keywords,
// and semantic errors that are always false positives from the transform)
export const ALWAYS_SUPPRESS = new Set([
	1003, 1005, 1109, 1128, 1136, 1381, 1434,
	2304, 2362, 2552, 2632, 2657, 2693, 2695, 2724, 2809,
	6385, 7026,
]);

// Errors suppressed only when they occur inside DarTsx-specific zones
// (control flow in JSX, bind: attributes) — legitimate type errors
// outside these zones are preserved (e.g. className vs class, fillOpacity vs fill-opacity)
export const ZONE_SUPPRESS = new Set([
	2322, // Type 'X' is not assignable to type 'Y'
	2339, // Property 'X' does not exist on type 'Y'
	2747, // 'X' is not a valid JSX element
]);

/**
 * Decide whether a single diagnostic inside a DarTsx file should be
 * suppressed. The caller is responsible for the isDarTsxFile check and
 * for computing suppress zones for the file.
 */
export function shouldSuppressDiagnostic(
	d: import('typescript').Diagnostic,
	zones: readonly SuppressZone[],
): boolean {
	if (!d.code) return false;
	if (ALWAYS_SUPPRESS.has(d.code)) return true;
	if (ZONE_SUPPRESS.has(d.code)) {
		const start = d.start ?? 0;
		return zones.some(z => start >= z.start && start < z.end);
	}
	return false;
}

/**
 * Filter diagnostics for one file: reads content through the given reader
 * and suppresses DarTsx false positives. Workers pass a `toSource` that
 * maps generated offsets back to source; tsserver positions are already
 * source-mapped and omit it.
 */
export function filterDarTsxDiagnostics(
	diags: import('typescript').Diagnostic[],
	fileName: string,
	readFile: (fileName: string) => string | undefined,
	toSource?: (fileName: string, offset: number) => number,
): import('typescript').Diagnostic[] {
	if (!diags.length) return diags;
	const content = readFile(fileName);
	if (content === undefined || !isDarTsxFile(content)) return diags;

	const zones = findSuppressZones(content);
	return diags.filter(d => !shouldSuppressDiagnostic(
		d.start === undefined ? d : { ...d, start: toSource ? toSource(fileName, d.start) : d.start },
		zones,
	));
}

/**
 * Unused CSS selector warnings for one file, as tsserver diagnostics
 * (custom code DARTSX_UNUSED_CSS_CODE, source 'dartsx').
 */
export function getUnusedCssDiagnostics(
	fileName: string,
	ts: typeof import('typescript'),
	readFile: (fileName: string) => string | undefined,
): import('typescript').Diagnostic[] {
	const content = readFile(fileName);
	if (content === undefined || !isDarTsxFile(content)) return [];

	const warnings = analyzeUnusedCss(content);
	if (warnings.length === 0) return [];

	const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	return warnings.map(w => ({
		file: sourceFile,
		start: w.start,
		length: w.length,
		messageText: w.message,
		category: 0 as import('typescript').DiagnosticCategory,
		code: DARTSX_UNUSED_CSS_CODE,
		source: 'dartsx',
	}));
}
