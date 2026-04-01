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
import { dartsxToTsx, isDarTsxFile } from './dartsx-to-tsx';
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
		const hasJsxSyntax = /\brender\s*\(/.test(source) || /<\w/.test(source);
		const isJavaScriptFile = fileName.endsWith('.js') || fileName.endsWith('.jsx');

		if (isJavaScriptFile) {
			this.serviceExtension = hasJsxSyntax || fileName.endsWith('.jsx') ? '.jsx' : '.js';
			this.scriptKind = this.serviceExtension === '.jsx' ? 2 : 1;
		} else {
			this.serviceExtension = hasJsxSyntax || fileName.endsWith('.tsx') ? '.tsx' : '.ts';
			this.scriptKind = this.serviceExtension === '.tsx' ? 4 : 3;
		}

		const { code, ms } = dartsxToTsx(source);

		// Build a single mapping that covers the whole file.
		// MagicString tracks all mutations, so we can build fine-grained
		// mappings from its internal state. For now, use the generated
		// source map to build Volar CodeMappings.
		this.mappings = buildMappings(ms, source, code);

		this.snapshot = {
			getText: (start, end) => code.substring(start, end),
			getLength: () => code.length,
			getChangeRange: () => undefined,
		};
	}
}

// ── Build Volar CodeMappings from MagicString ──────────────────────

function buildMappings(
	ms: import('magic-string').default,
	_source: string,
	generated: string,
): CodeMapping[] {
	// Generate a V3 source map from MagicString
	const map = ms.generateMap({ hires: 'boundary' });

	// We need to decode the mappings string into Volar's CodeMapping format.
	// Each mapping segment in a V3 source map is a VLQ-encoded tuple:
	// [generatedColumn, sourceIndex, sourceLine, sourceColumn, ?nameIndex]
	//
	// We'll parse the decoded mappings and build contiguous Volar mappings.
	const mappings: CodeMapping[] = [];

	// Decode the VLQ mappings manually using the raw mappings string
	const decoded = decodeMappings(map.mappings);

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
				const content = fs.readFileSync(filePath, 'utf-8').slice(0, 4096);
				if (isDarTsxFile(content)) {
					return 'dartsx';
				}
			} catch {
				// File might not exist on disk (e.g., untitled buffers)
			}

			return undefined;
		},

		createVirtualCode(_uri, languageId, snapshot) {
			if (languageId !== 'dartsx') return undefined;

			const fileName = typeof _uri === 'string' ? _uri : String(_uri);
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
