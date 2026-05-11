/**
 * DarTsx Volar Language Plugin
 *
 * Implements the Volar LanguagePlugin interface to provide TypeScript
 * intellisense for DarTsx .tsx files. Detects DarTsx files by content
 * (presence of `component` declarations), transforms them to valid TSX
 * via dartsxToTsx(), and provides Volar-compatible source mappings.
 */

import type {
	LanguagePlugin,
	VirtualCode,
	CodeMapping,
} from '@volar/language-core';
// Import @volar/typescript to get the module augmentation that adds
// `typescript` property to LanguagePlugin
import type { } from '@volar/typescript';
import { forEachEmbeddedCode } from '@volar/language-core';
import { dartsxToTsx, isDarTsxFile } from 'dartsx/dartsx-to-tsx';
import { skipBracedExpression } from './unused-css';
import * as fs from 'fs';

type IScriptSnapshot = import('@volar/language-core').IScriptSnapshot;

// ── Virtual Code ───────────────────────────────────────────────────

class DarTsxVirtualCode implements VirtualCode {
	id = 'root';
	languageId = 'dartsx';
	embeddedCodes: VirtualCode[] = [];
	mappings: CodeMapping[] = [];
	snapshot!: IScriptSnapshot;
	serviceExtension: '.js' | '.jsx' | '.ts' | '.tsx' = '.ts';
	scriptKind = 3;

	constructor(fileName: string, snapshot: IScriptSnapshot) {
		this.update(fileName, snapshot);
	}

	update(fileName: string, snapshot: IScriptSnapshot): void {
		const source = snapshot.getText(0, snapshot.getLength());

		// Determine service extension from the original file extension.
		// We must NOT use content heuristics (like /<\w/) because that
		// matches TypeScript generics (e.g. <TData>) and would incorrectly
		// assign .tsx to .ts files, causing a scriptKind mismatch crash.
		if (fileName.endsWith('.jsx')) {
			this.serviceExtension = '.jsx';
			this.scriptKind = 2;
		} else if (fileName.endsWith('.tsx')) {
			this.serviceExtension = '.tsx';
			this.scriptKind = 4;
		} else if (fileName.endsWith('.js')) {
			this.serviceExtension = '.js';
			this.scriptKind = 1;
		} else {
			this.serviceExtension = '.ts';
			this.scriptKind = 3;
		}

		let code: string;
		let mapMappings: string;
		try {
			const result = dartsxToTsx(source);
			code = result.code;
			mapMappings = result.map.mappings;
		} catch {
			// Fallback: pass source through unchanged
			code = source;
			mapMappings = '';
		}

		// Build Volar CodeMappings from the VLQ source map mappings
		this.mappings = buildMappings(mapMappings, source, code);

		this.snapshot = {
			getText: (start, end) => code.substring(start, end),
			getLength: () => code.length,
			getChangeRange: () => undefined,
		};

		// Extract embedded CSS virtual codes from <style> blocks
		this.embeddedCodes = [
			...extractCssVirtualCodes(source),
			...extractHtmlVirtualCode(source),
		];
	}
}

// ── Build Volar CodeMappings from VLQ source map ───────────────────

function buildMappings(
	vlqMappings: string,
	_source: string,
	generated: string,
): CodeMapping[] {
	// Decode the VLQ mappings string into Volar's CodeMapping format.
	// Each mapping segment in a V3 source map is a VLQ-encoded tuple:
	// [generatedColumn, sourceIndex, sourceLine, sourceColumn, ?nameIndex]
	const mappings: CodeMapping[] = [];

	const decoded = decodeMappings(vlqMappings);

	if (decoded.length === 0) {
		// Fallback: single identity mapping
		return [{
			sourceOffsets: [0],
			generatedOffsets: [0],
			lengths: [_source.length],
			generatedLengths: [generated.length],
			data: {
				verification: true,
				completion: true,
				semantic: true,
				navigation: true,
				structure: true,
				format: true,
			},
		}];
	}

	// Convert decoded segments into offset-based mappings
	// Group consecutive 1:1 mapped segments into contiguous ranges
	const sourceLines = _source.split('\n');
	const generatedLines = generated.split('\n');

	// Build line start offset arrays
	const sourceLineStarts = buildLineStarts(sourceLines);
	const generatedLineStarts = buildLineStarts(generatedLines);

	// Convert decoded segments to absolute offsets
	interface Segment {
		genOffset: number;
		srcOffset: number;
	}

	const segments: Segment[] = [];
	for (let line = 0; line < decoded.length; line++) {
		for (const seg of decoded[line]) {
			if (seg.length >= 4) {
				const genOffset = (generatedLineStarts[line] ?? 0) + seg[0];
				const srcOffset = (sourceLineStarts[seg[2]] ?? 0) + seg[3];
				segments.push({ genOffset, srcOffset });
			}
		}
	}

	if (segments.length === 0) {
		return [{
			sourceOffsets: [0],
			generatedOffsets: [0],
			lengths: [_source.length],
			generatedLengths: [generated.length],
			data: {
				verification: true,
				completion: true,
				semantic: true,
				navigation: true,
				structure: true,
				format: true,
			},
		}];
	}

	// Merge consecutive segments into contiguous regions where the
	// source-to-generated offset difference is constant
	let regionStart = 0;
	for (let i = 1; i <= segments.length; i++) {
		const continuable =
			i < segments.length &&
			// Same offset delta (1:1 correspondence continues)
			(segments[i].genOffset - segments[i].srcOffset) ===
			(segments[regionStart].genOffset - segments[regionStart].srcOffset) &&
			// No gaps in either source or generated
			segments[i].genOffset > segments[i - 1].genOffset &&
			segments[i].srcOffset > segments[i - 1].srcOffset;

		if (!continuable) {
			// Emit a mapping for this region
			const first = segments[regionStart];

			// Compute length: from first segment to the next segment (or end of file)
			const nextGenOffset = i < segments.length ? segments[i].genOffset : generated.length;
			const nextSrcOffset = i < segments.length ? segments[i].srcOffset : _source.length;

			const genLength = nextGenOffset - first.genOffset;
			const srcLength = nextSrcOffset - first.srcOffset;

			mappings.push({
				sourceOffsets: [first.srcOffset],
				generatedOffsets: [first.genOffset],
				lengths: [srcLength],
				generatedLengths: [genLength],
				data: {
					verification: true,
					completion: true,
					semantic: true,
					navigation: true,
					structure: true,
					format: true,
				},
			});

			regionStart = i;
		}
	}

	return mappings;
}

function buildLineStarts(lines: string[]): number[] {
	const starts: number[] = [0];
	for (let i = 0; i < lines.length - 1; i++) {
		starts.push(starts[i] + lines[i].length + 1); // +1 for \n
	}
	return starts;
}

// ── VLQ Decoder ────────────────────────────────────────────────────

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_CHAR_TO_INT: Record<string, number> = {};
for (let i = 0; i < VLQ_CHARS.length; i++) {
	VLQ_CHAR_TO_INT[VLQ_CHARS[i]] = i;
}

function decodeVLQ(encoded: string, index: number): [value: number, newIndex: number] {
	let result = 0;
	let shift = 0;
	let continuation: boolean;
	let i = index;

	do {
		const ch = encoded[i++];
		const digit = VLQ_CHAR_TO_INT[ch];
		continuation = (digit & 32) !== 0;
		result += (digit & 31) << shift;
		shift += 5;
	} while (continuation);

	const isNegative = result & 1;
	result >>= 1;
	return [isNegative ? -result : result, i];
}

function decodeMappings(mappings: string): number[][][] {
	const lines: number[][][] = [];
	let line: number[][] = [];

	let genCol = 0;
	let srcLine = 0;
	let srcCol = 0;
	let nameIdx = 0;

	let i = 0;
	while (i < mappings.length) {
		const ch = mappings[i];
		if (ch === ';') {
			lines.push(line);
			line = [];
			genCol = 0;
			i++;
		} else if (ch === ',') {
			i++;
		} else {
			const segment: number[] = [];

			// Generated column
			let val: number;
			[val, i] = decodeVLQ(mappings, i);
			genCol += val;
			segment.push(genCol);

			if (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
				// Source index (always 0 for single-source)
				[val, i] = decodeVLQ(mappings, i);
				segment.push(val);

				// Source line
				[val, i] = decodeVLQ(mappings, i);
				srcLine += val;
				segment.push(srcLine);

				// Source column
				[val, i] = decodeVLQ(mappings, i);
				srcCol += val;
				segment.push(srcCol);

				// Name index (optional)
				if (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
					[val, i] = decodeVLQ(mappings, i);
					nameIdx += val;
					segment.push(nameIdx);
				}
			}

			line.push(segment);
		}
	}

	if (line.length > 0) {
		lines.push(line);
	}

	return lines;
}

// ── Embedded CSS Virtual Codes ─────────────────────────────────────

function extractCssVirtualCodes(source: string): VirtualCode[] {
	const codes: VirtualCode[] = [];
	const re = /<style(\s+global)?\s*>/gi;
	let match;
	let idx = 0;

	while ((match = re.exec(source)) !== null) {
		const cssStart = match.index + match[0].length;
		const closeIdx = source.indexOf('</style>', cssStart);
		if (closeIdx === -1) continue;

		// Replace {expr} interpolations with same-length placeholders
		// so the CSS parser sees valid CSS while preserving offsets.
		const rawCss = source.slice(cssStart, closeIdx);
		const css = rawCss.replace(
			/\{[a-zA-Z_$][a-zA-Z0-9_$.]*\}/g,
			m => '_'.repeat(m.length),
		);

		codes.push({
			id: `style_${idx}`,
			languageId: 'css',
			snapshot: {
				getText: (start, end) => css.substring(start, end),
				getLength: () => css.length,
				getChangeRange: () => undefined,
			},
			mappings: [{
				sourceOffsets: [cssStart],
				generatedOffsets: [0],
				lengths: [css.length],
				data: {
					completion: true,
					semantic: true,
					navigation: true,
					structure: true,
					format: true,
				},
			}],
			embeddedCodes: [],
		});

		idx++;
	}

	return codes;
}

// ── Embedded HTML Virtual Code ─────────────────────────────────────

function extractHtmlVirtualCode(source: string): VirtualCode[] {
	// Find render(...) blocks and collect their JSX content regions
	const renderRe = /\brender\s*\(/g;
	const regions: { start: number; end: number }[] = [];
	let m;
	while ((m = renderRe.exec(source)) !== null) {
		const open = source.indexOf('(', m.index);
		if (open === -1) continue;
		const close = findMatchingParen(source, open);
		if (close <= open) continue;
		regions.push({ start: open + 1, end: close });
	}
	if (regions.length === 0) return [];

	// Start with everything blanked, then copy in render regions
	const chars: string[] = [];
	for (let i = 0; i < source.length; i++) {
		chars[i] = source[i] === '\n' ? '\n' : ' ';
	}
	for (const r of regions) {
		for (let i = r.start; i < r.end; i++) chars[i] = source[i];
	}

	let html = chars.join('');

	// Blank <style> blocks (CSS service handles those)
	html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ' '));
	// Blank {expressions}, but preserve HTML inside control-flow blocks
	const out = html.split('');
	for (const r of regions) {
		blankExpressions(html, out, r.start, r.end);
	}
	html = out.join('');
	// Blank component tags (capitalized) — HTML service doesn't know them
	html = html.replace(/<\/?[A-Z][a-zA-Z0-9_$]*/g, m => ' '.repeat(m.length));

	return [{
		id: 'html',
		languageId: 'html',
		snapshot: {
			getText: (start, end) => html.substring(start, end),
			getLength: () => html.length,
			getChangeRange: () => undefined,
		},
		mappings: [{
			sourceOffsets: [0],
			generatedOffsets: [0],
			lengths: [source.length],
			data: {
				completion: true,
				semantic: true,
				navigation: true,
				structure: true,
				format: false,
			},
		}],
		embeddedCodes: [],
	}];
}

/**
 * Blank {expression} blocks within a render region.
 * Control-flow blocks (containing `render`) are handled recursively:
 * the JS syntax is blanked but the HTML after `render` is preserved.
 */
function blankExpressions(source: string, out: string[], start: number, end: number): void {
	let i = start;
	while (i < end) {
		if (source[i] === '{') {
			const braceEnd = skipBracedExpression(source, i);
			if (/\brender[\s\n]/.test(source.slice(i, braceEnd))) {
				// Control flow: blank everything, then restore HTML after render keywords
				for (let j = i; j < braceEnd; j++) if (out[j] !== '\n') out[j] = ' ';
				restoreRenderContent(source, out, i + 1, braceEnd - 1);
			} else {
				// Pure expression like {count}: blank entirely
				for (let j = i; j < braceEnd; j++) if (out[j] !== '\n') out[j] = ' ';
			}
			i = braceEnd;
		} else {
			i++;
		}
	}
}

/**
 * Within a blanked control-flow block, find `render` keywords and
 * restore the HTML/JSX that follows each one. Recursively blanks
 * any nested {expressions} inside the restored content.
 */
function restoreRenderContent(source: string, out: string[], start: number, end: number): void {
	const renderRe = /\brender[\s\n]/g;
	renderRe.lastIndex = start;
	let m;
	while ((m = renderRe.exec(source)) !== null && m.index < end) {
		let jsxStart = m.index + m[0].length;
		while (jsxStart < end && /\s/.test(source[jsxStart])) jsxStart++;

		// Find the closing } for this clause, skipping nested {…} blocks
		let jsxEnd = end;
		for (let k = jsxStart; k < end; k++) {
			const ch = source[k];
			if (ch === '{') { k = skipBracedExpression(source, k) - 1; }
			else if (ch === '}') { jsxEnd = k; break; }
		}

		// Restore JSX characters
		for (let k = jsxStart; k < jsxEnd; k++) out[k] = source[k];
		// Recursively blank {expressions} within the restored JSX
		blankExpressions(source, out, jsxStart, jsxEnd);

		renderRe.lastIndex = jsxEnd;
	}
}

/** Find the index of the closing `)` matching the `(` at openIdx. */
function findMatchingParen(source: string, openIdx: number): number {
	let depth = 1;
	for (let i = openIdx + 1; i < source.length; i++) {
		const ch = source[i];
		if (ch === '(') depth++;
		else if (ch === ')') { if (--depth === 0) return i; }
		else if (ch === '{') { i = skipBracedExpression(source, i) - 1; }
		else if (ch === '"' || ch === "'" || ch === '`') { i = skipString(source, i); }
		else if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i) ?? source.length; }
		else if (ch === '/' && source[i + 1] === '*') { i = (source.indexOf('*/', i + 2) + 1) || source.length; }
	}
	return -1;
}

function skipString(source: string, start: number): number {
	const q = source[start];
	for (let i = start + 1; i < source.length; i++) {
		if (source[i] === '\\') { i++; continue; }
		if (source[i] === q) return i;
		if (q === '`' && source[i] === '$' && source[i + 1] === '{') {
			i = skipBracedExpression(source, i + 1) - 1;
		}
	}
	return source.length;
}

// ── Language Plugin ────────────────────────────────────────────────

export function getDarTsxLanguagePlugin<T = any>(): LanguagePlugin<T, DarTsxVirtualCode> {
	return {
		getLanguageId(scriptId: T) {
			const fileName = typeof scriptId === 'string'
				? scriptId
				: typeof (scriptId as any)?.fsPath === 'string'
					? (scriptId as any).fsPath.replace(/\\/g, '/')
					: String(scriptId);

			if (!fileName.endsWith('.tsx') && !fileName.endsWith('.ts') && !fileName.endsWith('.jsx') && !fileName.endsWith('.js')) return undefined;
			// Skip .d.ts files
			if (fileName.endsWith('.d.ts')) return undefined;

			// Read file content to determine if it's DarTsx.
			// Only claim files that actually contain DarTsx syntax.
			// Non-DarTsx .tsx files must be left to native TS handling.
			try {
				// Strip file:// URI scheme if present
				const filePath = fileName.startsWith('file://')
					? decodeURIComponent(fileName.slice(7))
					: fileName;
				const content = fs.readFileSync(filePath, 'utf-8');
				if (isDarTsxFile(content)) {
					return 'dartsx';
				}
			} catch {
				// File might not exist on disk (e.g., untitled buffers)
			}

			return undefined;
		},

		createVirtualCode(_uri, languageId, snapshot) {
			// In TS plugin context, languageId is 'dartsx' (from getLanguageId).
			// In language server context, languageId is the document's original
			// languageId (e.g. 'typescriptreact') since the server passes it directly.
			const accepted = new Set(['dartsx', 'typescript', 'typescriptreact', 'javascript', 'javascriptreact']);
			if (!accepted.has(languageId)) return undefined;

			const fileName = typeof _uri === 'string' ? _uri : String(_uri);

			// Never transform .d.ts files — TS lib files can false-positive on
			// isDarTsxFile (e.g. `state` in PromiseState, `derived` in comments)
			if (fileName.endsWith('.d.ts')) return undefined;

			// For non-dartsx languageIds, verify content is actually DarTsx
			if (languageId !== 'dartsx') {
				const source = snapshot.getText(0, snapshot.getLength());
				if (!isDarTsxFile(source)) return undefined;
			}

			return new DarTsxVirtualCode(fileName, snapshot);
		},

		updateVirtualCode(_uri, virtualCode, snapshot) {
			const fileName = typeof _uri === 'string' ? _uri : String(_uri);
			virtualCode.update(fileName, snapshot);
			return virtualCode;
		},

		typescript: {
			extraFileExtensions: [],
			getServiceScript(root) {
				for (const code of forEachEmbeddedCode(root)) {
					if (code.languageId === 'dartsx') {
						const virtualCode = root as DarTsxVirtualCode;
						return {
							code,
							extension: virtualCode.serviceExtension,
							scriptKind: virtualCode.scriptKind,
						};
					}
				}
				return undefined;
			},
		},
	};
}
