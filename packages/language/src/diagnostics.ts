/**
 * DarTsx diagnostic filtering.
 *
 * TS diagnostics that are false positives of the DarTsx→TSX transform are
 * suppressed: always-suppressed error codes, plus errors inside DarTsx
 * control-flow zones (JSX control flow, bind: attributes) where legitimate
 * type errors outside those zones are preserved.
 */

import { isDarTsxFile, findSuppressZones, type SuppressZone } from 'dartsx/compiler/preprocess';
import { analyzeUnusedCss, DARTSX_UNUSED_CSS_CODE } from './unused-css';
import type { ReadFileSync } from './language';

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

export function filterDarTsxDiagnostics(
	diags: import('typescript').Diagnostic[],
	fileName: string,
	readFileSync: ReadFileSync,
): import('typescript').Diagnostic[] {
	if (!diags.length) return diags;
	let content: string;
	try {
		content = readFileSync(fileName);
	} catch {
		return diags;
	}
	if (!isDarTsxFile(content)) return diags;

	let zones: SuppressZone[] | undefined;

	return diags.filter(d => {
		if (!d.code) return true;
		if (ALWAYS_SUPPRESS.has(d.code)) return false;
		if (ZONE_SUPPRESS.has(d.code)) {
			if (!zones) zones = findSuppressZones(content);
			const start = d.start ?? 0;
			return !zones.some(z => start >= z.start && start < z.end);
		}
		return true;
	});
}

// ── Unused CSS selector detection ──────────────────────────────────

export function getUnusedCssDiagnostics(fileName: string, ts: typeof import('typescript'), readFileSync: ReadFileSync): import('typescript').Diagnostic[] {
	let content: string;
	try {
		content = readFileSync(fileName);
	} catch {
		return [];
	}
	if (!isDarTsxFile(content)) return [];

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