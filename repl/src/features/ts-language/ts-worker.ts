// Solid-repl's tsWorker.ts with two layers grafted in — its structure
// (openDocs / positionConverters / handleRequest switch) is unchanged; the
// additions are exactly what our language needs:
//
//   1. Bundled declarations are dartsx (+ toolkit) instead of solid-js/csstype,
//      mounted at the same `file:///node_modules/...`.
//   2. DarTsx documents: user files are not valid TSX (`component`, `state x: T =`,
//      `{if}` …), so every open/change runs the compiler's own preprocessor in
//      `typecheck` mode and keeps the MagicString source map. Every offset
//      crossing a request/response boundary is converted between AUTHORED
//      coordinates (what the editor sees) and GENERATED coordinates (what the
//      service sees).
//   3. DarTsx language behavior comes from @dartsx/language-service — the
//      same Node-free core the tsserver plugin and `dartsx check` use:
//        - quick-info rewriting (function→component, let/var→state,
//          const/var→derived, prop labels, props-overload display)
//        - diagnostic suppression rules (always-suppressed + zone-scoped codes)
//        - unused-CSS selector warnings
//      The core is host-agnostic: it reads file contents through readFile and
//      maps generated→authored offsets through toSource. This worker backs
//      both seams with its DarTsx document set (coreReadFile/coreToSource).
import { createSystem, createVirtualTypeScriptEnvironment, type VirtualTypeScriptEnvironment } from '@typescript/vfs';
import ts, {
	type CompilerOptions,
	JsxEmit,
	ModuleKind,
	ModuleResolutionKind,
	ScriptTarget,
	displayPartsToString,
} from 'typescript';
import { isDarTsxFile, findSuppressZones, preprocess, type SuppressZone } from 'dartsx/compiler/preprocess';
import { decode } from '@jridgewell/sourcemap-codec';
import { analyzeUnusedCss, getQuickInfoWithDarTsxKeywords, shouldSuppressDiagnostic } from '@dartsx/language-service';
import { createTypeAcquisition } from './type-acquisition';

let compilerOptions: CompilerOptions = {
	strict: true,
	target: ScriptTarget.ESNext,
	module: ModuleKind.ESNext,
	jsx: JsxEmit.Preserve,
	jsxImportSource: 'dartsx',
	moduleResolution: ModuleResolutionKind.Bundler,
	allowNonTsExtensions: true,
};

const tsLibs = import.meta.glob<string>(
	[
		'/node_modules/typescript/lib/lib.*.d.ts',
		'!/node_modules/typescript/lib/lib.webworker*.d.ts',
		'!/node_modules/typescript/lib/lib.scripthost*.d.ts',
	],
	{ eager: true, query: '?raw', import: 'default' },
);

// Framework types under node_modules/<pkg>/..., package.json included so
// bundler-style resolution walks exports → types.
const bundledPackages = import.meta.glob<string>(
	[
		'/node_modules/dartsx/**/*.{d.ts,json}',
		'/node_modules/@dartsx-toolkit/*/dist/**/*.{d.ts,json}',
		'!/node_modules/*/node_modules/**',
		'!/node_modules/@dartsx-toolkit/*/node_modules/**',
	],
	{ eager: true, query: '?raw', import: 'default' },
);

const fsMap = new Map<string, string>();
for (const path in tsLibs) {
	const last = path.split('/').at(-1)!;
	fsMap.set(`/${last}`, tsLibs[path]);
}
for (const path in bundledPackages) {
	fsMap.set(`file://${path}`, bundledPackages[path]);
}

const system = createSystem(fsMap);
const typeAcquisition = createTypeAcquisition(fsMap);

// ── DarTsx documents ────────────────────────────────────────────────────

interface Document {
	raw: string;
	preprocessed: string;
	isDarTsx: boolean;
	/** Cached parse of the AUTHORED source for position math. */
	rawSource?: ts.SourceFile;
	/** Sorted [generatedOffset, originalOffset] anchors; null when identity. */
	genToRaw: [number, number][] | null;
	/** Sorted [originalOffset, generatedOffset] anchors; null when identity. */
	rawToGen: [number, number][] | null;
}

const openDocs = new Map<string, Document>();

const lineStarts = (doc: string): number[] => {
	const starts = [0];
	for (let i = 0; i < doc.length; i++) {
		if (doc.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return starts;
};

/** Greatest anchor ≤ offset on a sorted pair table, plus the residual delta. */
function tracePairs(pairs: [number, number][], offset: number): number | null {
	let low = 0;
	let high = pairs.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (pairs[mid]![0] <= offset) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found < 0 ? null : pairs[found]![1]! + (offset - pairs[found]![0]!);
}

/**
 * Build both-direction offset tables from the preprocess source map. MagicString
 * emits VLQ segments per generated line: [genCol, srcIdx, srcLine, srcCol].
 */
function buildDocument(raw: string): Document {
	const isDart = isDarTsxFile(raw);
	if (!isDart) {
		return { raw, preprocessed: raw, isDarTsx: false, genToRaw: null, rawToGen: null };
	}
	try {
		const result = preprocess(raw, { mode: 'typecheck' });
		const decoded = decode(result.map.mappings);
		const genLineStarts = lineStarts(result.code);
		const rawLineStarts = lineStarts(raw);
		const pairs: [number, number][] = [];
		for (let genLine = 0; genLine < decoded.length; genLine++) {
			const genBase = genLineStarts[genLine];
			if (genBase === undefined) break;
			for (const segment of decoded[genLine]!) {
				const rawBase = rawLineStarts[segment[2]!];
				if (rawBase === undefined || segment[3] === undefined) continue;
				pairs.push([genBase + segment[0]!, rawBase + segment[3]]);
			}
		}
		if (pairs.length === 0) {
			return { raw, preprocessed: result.code, isDarTsx: true, genToRaw: null, rawToGen: null };
		}
		pairs.sort((a, b) => a[0] - b[0]);
		const rawToGen = pairs.map(([gen, r]) => [r, gen] as [number, number]).sort((a, b) => a[0] - b[0]);
		return { raw, preprocessed: result.code, isDarTsx: true, genToRaw: pairs, rawToGen };
	} catch {
		// Preprocess failure: identity so syntax-level diagnostics still surface
		// rather than silence.
		return { raw, preprocessed: raw, isDarTsx: true, genToRaw: null, rawToGen: null };
	}
}

const docFor = (uri: string): Document | undefined => openDocs.get(uri);

const rawOffsetToPos = (doc: Document, offset: number): Position => {
	doc.rawSource ??= ts.createSourceFile('raw.tsx', doc.raw, ts.ScriptTarget.ESNext, false);
	const lc = doc.rawSource.getLineAndCharacterOfPosition(Math.min(offset, doc.raw.length));
	return { line: lc.line, character: lc.character };
};

const rawPosToOffset = (doc: Document, pos: Position): number => {
	doc.rawSource ??= ts.createSourceFile('raw.tsx', doc.raw, ts.ScriptTarget.ESNext, false);
	return ts.getPositionOfLineAndCharacter(doc.rawSource, pos.line, pos.character);
};

/** Authored offset → generated offset (nearest preceding anchor inside inserted regions). */
const toGenerated = (doc: Document, offset: number): number =>
	doc.rawToGen ? (tracePairs(doc.rawToGen, offset) ?? 0) : offset;

/** Generated offset → authored offset; null when before any mapping anchor. */
const toRaw = (doc: Document, offset: number): number | null =>
	doc.genToRaw ? tracePairs(doc.genToRaw, offset) : offset;

// ── Language-core seams ─────────────────────────────────────────────────
// @dartsx/language-service is Node-free by design: hosts pass a readFile
// (file content, undefined = degrade) and an optional toSource (generated →
// authored offset). Here both are backed by the DarTsx document set; a
// non-workspace file (.d.ts) reads as undefined and offsets pass through.

/** Authored content for workspace files — what the core's regexes scan. */
const coreReadFile = (fileName: string): string | undefined => docFor(fileName)?.raw;

/** Service (generated) offset → authored offset for the file it belongs to. */
const coreToSource = (fileName: string, offset: number): number => {
	const doc = docFor(fileName);
	return doc ? (toRaw(doc, offset) ?? offset) : offset;
};

/** Authored LSP position → generated offset for language-service calls. */
const requestOffset = (uri: string, pos: Position): number | null => {
	const doc = docFor(uri);
	if (!doc) return null;
	return toGenerated(doc, rawPosToOffset(doc, pos));
};

type LspRange = { start: Position; end: Position };

/**
 * Map a service span in THIS document back to authored coordinates. Targets in
 * other files (real .d.ts) have no mapping and pass through untouched.
 */
const responseRange = (
	requestUri: string,
	fileName: string,
	start: number,
	length: number,
): { uri: string; range: LspRange } => {
	const doc = fileName === requestUri ? docFor(requestUri) : undefined;
	if (doc) {
		const rawStart = toRaw(doc, start);
		if (rawStart !== null) {
			const rawEnd = toRaw(doc, start + length) ?? rawStart;
			return { uri: fileName, range: { start: rawOffsetToPos(doc, rawStart), end: rawOffsetToPos(doc, rawEnd) } };
		}
	}
	return {
		uri: fileName,
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
	};
};

const buildEnv = () =>
	createVirtualTypeScriptEnvironment(system, [], ts, {
		...compilerOptions,
		jsxImportSource: typeAcquisition.jsxImportSource() ?? compilerOptions.jsxImportSource,
	});

let env = buildEnv();

const rebuildEnv = () => {
	env = buildEnv();
	for (const [uri, doc] of openDocs) env.createFile(uri, doc.preprocessed);
};

const completionItemKind: Record<string, number> = {
	'class': 7,
	'interface': 8,
	'method': 2,
	'module': 9,
	'property': 10,
	'string': 1,
	'type': 22,
	'var': 6,
	'local var': 6,
	'const': 21,
	'let': 21,
	'function': 3,
	'local function': 3,
	'keyword': 14,
	'enum': 13,
	'enum member': 20,
	'parameter': 6,
	'alias': 18,
	'primitive': 22,
};

type Position = { line: number; character: number };

const positionConverters = (env: VirtualTypeScriptEnvironment, uri: string) => {
	const sourceFile = env.getSourceFile(uri);
	return {
		offsetToPos: (offset: number): Position => {
			if (!sourceFile) return { line: 0, character: 0 };
			const lc = sourceFile.getLineAndCharacterOfPosition(offset);
			return { line: lc.line, character: lc.character };
		},
		posToOffset: (pos: Position): number => {
			if (!sourceFile) return 0;
			return ts.getPositionOfLineAndCharacter(sourceFile, pos.line, pos.character);
		},
	};
};

const ensureFile = (uri: string, text: string) => {
	const existingDoc = openDocs.get(uri);
	if (existingDoc && existingDoc.raw === text) return;
	const doc = buildDocument(text);
	openDocs.set(uri, doc);
	const existing = env.getSourceFile(uri);
	if (existing) env.updateFile(uri, doc.preprocessed);
	else env.createFile(uri, doc.preprocessed);
};

const removeFile = (uri: string) => {
	openDocs.delete(uri);
	if (!env.getSourceFile(uri)) return;
	env.deleteFile(uri);
};

class MethodNotFound extends Error {
	constructor(method: string) {
		super(`Method not found: ${method}`);
	}
}

const handleRequest = (method: string, params: any) => {
	switch (method) {
		case 'initialize':
			return {
				capabilities: {
					textDocumentSync: 1,
					hoverProvider: true,
					completionProvider: { resolveProvider: true, triggerCharacters: ['.'] },
					signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
					definitionProvider: true,
					referencesProvider: true,
					renameProvider: { prepareProvider: true },
				},
			};

		case 'shutdown':
			return null;

		case 'textDocument/completion': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			const completions = env.languageService.getCompletionsAtPosition(uri, offset, {});
			if (!completions) return null;
			return {
				isIncomplete: !!completions.isIncomplete,
				items: completions.entries
					// Preprocessor artifacts ($$s0 state markers etc.) are not names
					// the visitor wrote — keep them out of the list.
					.filter((c) => !c.name.startsWith('$$'))
					.map((c) => ({
						label: c.name,
						kind: completionItemKind[c.kind] ?? 1,
						sortText: c.sortText,
						data: { uri, offset, name: c.name, source: c.source },
					})),
			};
		}

		case 'completionItem/resolve': {
			const data = params.data;
			if (!data) return params;
			const details = env.languageService.getCompletionEntryDetails(
				data.uri,
				data.offset,
				data.name,
				{},
				data.source,
				undefined,
				undefined,
			);
			if (!details) return params;
			const detail = displayPartsToString(details.displayParts);
			const docs = displayPartsToString(details.documentation);
			return {
				...params,
				detail,
				documentation: docs ? { kind: 'markdown', value: docs } : undefined,
			};
		}

		case 'textDocument/hover': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			// Speak DarTsx before displaying (component/state/derived keywords…).
			// The core fetches quick info itself and rewrites it through our seams;
			// textSpan stays in service coordinates, so responseRange still maps it.
			const info = getQuickInfoWithDarTsxKeywords(env.languageService, uri, offset, coreReadFile, coreToSource);
			if (!info) return null;
			const signature = displayPartsToString(info.displayParts);
			const docs = displayPartsToString(info.documentation ?? []);
			const value = '```typescript\n' + signature + '\n```' + (docs ? '\n\n' + docs : '');
			return {
				contents: { kind: 'markdown', value },
				range: responseRange(uri, uri, info.textSpan.start, info.textSpan.length).range,
			};
		}

		case 'textDocument/signatureHelp': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			const help = env.languageService.getSignatureHelpItems(uri, offset, {});
			if (!help) return null;
			return {
				signatures: help.items.map((item) => {
					const prefix = displayPartsToString(item.prefixDisplayParts);
					const separator = displayPartsToString(item.separatorDisplayParts);
					const suffix = displayPartsToString(item.suffixDisplayParts);
					const sigParams = item.parameters.map((p) => ({
						text: displayPartsToString(p.displayParts),
						doc: displayPartsToString(p.documentation),
					}));
					const label = prefix + sigParams.map((p) => p.text).join(separator) + suffix;
					let cursor = prefix.length;
					const lspParams = sigParams.map((p) => {
						const start = cursor;
						const end = start + p.text.length;
						cursor = end + separator.length;
						return {
							label: [start, end] as [number, number],
							documentation: p.doc ? { kind: 'markdown', value: p.doc } : undefined,
						};
					});
					const itemDocs = displayPartsToString(item.documentation);
					return {
						label,
						documentation: itemDocs ? { kind: 'markdown', value: itemDocs } : undefined,
						parameters: lspParams,
					};
				}),
				activeSignature: help.selectedItemIndex,
				activeParameter: help.argumentIndex,
			};
		}

		case 'textDocument/definition': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			const defs = env.languageService.getDefinitionAtPosition(uri, offset);
			if (!defs?.length) return null;
			return defs.map((d) => responseRange(uri, d.fileName, d.textSpan.start, d.textSpan.length));
		}

		case 'textDocument/references': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			const refs = env.languageService.getReferencesAtPosition(uri, offset);
			if (!refs) return null;
			return refs.map((r) => responseRange(uri, r.fileName, r.textSpan.start, r.textSpan.length));
		}

		case 'textDocument/prepareRename': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			const info = env.languageService.getRenameInfo(uri, offset, { allowRenameOfImportPath: false });
			if (!info.canRename) return null;
			return {
				range: responseRange(uri, uri, info.triggerSpan.start, info.triggerSpan.length).range,
				placeholder: info.displayName,
			};
		}

		case 'textDocument/rename': {
			const uri = params.textDocument.uri;
			const offset = requestOffset(uri, params.position);
			if (offset === null) return null;
			const info = env.languageService.getRenameInfo(uri, offset, { allowRenameOfImportPath: false });
			if (!info.canRename) return null;
			const locations = env.languageService.findRenameLocations(uri, offset, false, false, {});
			if (!locations) return null;
			const newName: string = params.newName;
			const changes: Record<string, { range: { start: Position; end: Position }; newText: string }[]> = {};
			for (const loc of locations) {
				(changes[loc.fileName] ||= []).push({
					range: responseRange(uri, loc.fileName, loc.textSpan.start, loc.textSpan.length).range,
					newText: (loc.prefixText ?? '') + newName + (loc.suffixText ?? ''),
				});
			}
			return { changes };
		}

		case 'playground/syncTypes':
			return typeAcquisition.sync(params.importMap ?? {}).then((changed) => {
				if (changed) rebuildEnv();
				return { changed };
			});

		case 'playground/syncTsconfig': {
			// No solid counterpart: our tsconfig.json is a visitor-editable
			// workspace file. JSON compilerOptions merge over the defaults.
			const config = (params.config ?? {}) as { compilerOptions?: Record<string, unknown> };
			const json = config.compilerOptions && typeof config.compilerOptions === 'object'
				? config.compilerOptions
				: {};
			const converted = ts.convertCompilerOptionsFromJson(json, '/');
			compilerOptions = {
				...compilerOptions,
				...(converted.options as CompilerOptions),
				allowNonTsExtensions: true,
			};
			rebuildEnv();
			return { changed: true };
		}

		case 'playground/diagnostics': {
			const uri = params.uri;
			const doc = docFor(uri);
			if (!doc) return [];
			const mapped: {
				start: number;
				length: number;
				severity: number;
				message: string;
			}[] = [];
			// Suppression zones live in the AUTHORED source; the suppression
			// rules themselves come from the shared language core.
			let zones: SuppressZone[] | undefined;
			for (const d of [
				...env.languageService.getSyntacticDiagnostics(uri),
				...env.languageService.getSemanticDiagnostics(uri),
			]) {
				// Diagnostics anchored before every mapping anchor cannot be shown
				// truthfully in the authored source — drop them rather than misplace.
				if (d.start == null) continue;
				const rawStart = toRaw(doc, d.start);
				if (rawStart === null) continue;
				zones ??= doc.isDarTsx ? findSuppressZones(doc.raw) : [];
				if (d.code && shouldSuppressDiagnostic({ ...d, start: rawStart }, zones)) continue;
				const message =
					typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText;
				mapped.push({ start: rawStart, length: d.length ?? 0, severity: d.category, message });
			}
			// Unused-CSS selector warnings (authored coordinates already).
			if (doc.isDarTsx) {
				for (const w of analyzeUnusedCss(doc.raw)) {
					mapped.push({
						start: w.start,
						length: w.length,
						severity: 0 as ts.DiagnosticCategory.Warning,
						message: w.message,
					});
				}
			}
			return mapped;
		}

		default:
			throw new MethodNotFound(method);
	}
};

const handleNotification = (method: string, params: any) => {
	switch (method) {
		case 'initialized':
			return;
		case 'textDocument/didOpen':
			ensureFile(params.textDocument.uri, params.textDocument.text);
			return;
		case 'textDocument/didChange': {
			const uri = params.textDocument.uri;
			const change = params.contentChanges[params.contentChanges.length - 1];
			if (change && 'text' in change && !('range' in change)) {
				ensureFile(uri, change.text);
			}
			return;
		}
		case 'textDocument/didClose':
			removeFile(params.textDocument.uri);
			return;
		default:
			return;
	}
};

self.addEventListener('message', async (e: MessageEvent) => {
	const msg = e.data;
	if (msg.id !== undefined && msg.method) {
		try {
			const result = await handleRequest(msg.method, msg.params);
			self.postMessage({ jsonrpc: '2.0', id: msg.id, result });
		} catch (err) {
			self.postMessage({
				jsonrpc: '2.0',
				id: msg.id,
				error: {
					code: err instanceof MethodNotFound ? -32601 : -32603,
					message: err instanceof Error ? err.message : 'Internal error',
				},
			});
		}
	} else if (msg.method) {
		handleNotification(msg.method, msg.params);
	}
});
