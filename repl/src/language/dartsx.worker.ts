// DarTsx language worker: TypeScript language features for the playground.
//
// Mirrors the vue-repl worker (src/monaco/vue.worker.ts) on the
// @volar/monaco pair: createTypeScriptWorkerLanguageService here,
// activateMarkers/registerProviders on the main thread. Two deviations from
// vue-repl, both forced by the repl's stack:
//   1. transport — the codingame monaco fork removed createWebWorker, so
//      mirrored models arrive via the protocol's full-text sync messages
//      instead of monaco's mirror-model machinery (see ./index.ts).
//   2. the semantic plugin is wrapped with the DarTsx post-processing from
//      @dartsx/language-service — the same diagnostic filter, unused-CSS
//      warnings and hover keyword rewriting the desktop tsserver plugin
//      applies.
// TypeScript itself and the dartsx .d.ts files are bundled in via
// ./virtual-fs.ts (fetched at boot), so type checking works offline.

import * as ts from 'typescript';
import { URI } from 'vscode-uri';
import { createTypeScriptWorkerLanguageService, type WorkerLanguageService } from '@volar/monaco/worker';
import type { Language } from '@volar/language-service';
import { create as createSemanticPlugin } from 'volar-service-typescript/lib/plugins/semantic';
import { create as createDirectiveCommentPlugin } from 'volar-service-typescript/lib/plugins/directiveComment';
import {
	DarTsxVirtualCode,
	filterDarTsxDiagnostics,
	getDarTsxLanguagePlugin,
	getQuickInfoWithDarTsxKeywords,
	getUnusedCssDiagnostics,
} from '@dartsx/language-service';
import { virtualFs, loadVirtualFs } from './virtual-fs';
import type { WorkerInbound, WorkerOutbound } from './protocol';

// ── mirrored project files (stand-in for monaco's mirror models) ────

interface Mirror {
	uri: URI;
	version: number;
	text: string;
}

const mirrors = new Map<string, Mirror>();

function readSourceFile(fileName: string): string | undefined {
	const mirror = mirrors.get(URI.file(fileName).toString());
	if (mirror) return mirror.text;
	return virtualFs.readFile(fileName);
}

// ── service construction ────────────────────────────────────────────

let service: WorkerLanguageService | null = null;
let compilerOptionsJson: Record<string, unknown> | null = null;
let languageRef: Language | undefined;

function buildService(): void {
	service?.dispose();
	languageRef = undefined;

	const converted = ts.convertCompilerOptionsFromJson(compilerOptionsJson ?? {}, '/tmp/project');
	const compilerOptions: ts.CompilerOptions = {
		...converted.options,
		allowNonTsExtensions: true,
	};
	for (const diagnostic of converted.errors) {
		console.warn('[dartsx-worker] tsconfig:', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
	}

	service = createTypeScriptWorkerLanguageService({
		typescript: ts,
		compilerOptions,
		env: {
			workspaceFolders: [URI.file('/')],
			locale: 'en',
			fs: {
				stat(uri: URI) {
					return virtualFs.stat(uri.path);
				},
				readFile(uri: URI) {
					return virtualFs.readFile(uri.path);
				},
				readDirectory(uri: URI) {
					return virtualFs.readDirectory(uri.path);
				},
			},
		},
		uriConverter: {
			asFileName: uri => uri.path,
			asUri: fileName => URI.file(fileName),
		},
		workerContext: {
			// The `host` channel (worker→main-thread callbacks like
			// onFetchCdnFile in the vue worker) is unused here.
			host: undefined,
			getMirrorModels: () => [...mirrors.values()].map(mirror => ({
				uri: mirror.uri,
				version: mirror.version,
				getValue: () => mirror.text,
			})),
		},
		languagePlugins: [
			getDarTsxLanguagePlugin(readSourceFile),
		],
		languageServicePlugins: makePlugins(),
	});
}

// ── DarTsx post-processing (same rules as the tsserver plugin) ──────

function makePlugins() {
	const semantic = createSemanticPlugin(ts);
	const originalCreate = semantic.create.bind(semantic);
	semantic.create = context => {
		languageRef ??= context.language;
		const created = originalCreate(context);
		const ls = created.provide?.['typescript/languageService']?.() as ts.LanguageService | undefined;
		if (ls) {
			patchLanguageService(ls);
		}
		return created;
	};
	return [semantic, createDirectiveCommentPlugin()];
}

function toSource(fileName: string, offset: number): number {
	const root = languageRef?.scripts.get(URI.file(fileName))?.generated?.root;
	if (!(root instanceof DarTsxVirtualCode)) return offset;
	for (const mapping of root.mappings) {
		const lengths = mapping.generatedLengths ?? mapping.lengths;
		for (let i = 0; i < mapping.generatedOffsets.length; i++) {
			const generatedStart = mapping.generatedOffsets[i];
			if (offset >= generatedStart && offset < generatedStart + lengths[i]) {
				return mapping.sourceOffsets[i] + (offset - generatedStart);
			}
		}
	}
	return offset;
}

const quickInfoToSource = (fileName: string, offset: number): number => toSource(fileName, offset);

function filterForFile(fileName: string) {
	return (diags: ts.Diagnostic[]) => filterDarTsxDiagnostics(diags, fileName, readSourceFile, quickInfoToSource);
}

// Unused-CSS warnings come back in source offsets; the volar layer above maps
// diagnostics from generated offsets back to source, so translate them through
// the inverse mapping before appending (see getUnusedCssDiagnostics).
function toGenerated(fileName: string, offset: number): number {
	const root = languageRef?.scripts.get(URI.file(fileName))?.generated?.root;
	if (!(root instanceof DarTsxVirtualCode)) return offset;
	for (const mapping of root.mappings) {
		for (let i = 0; i < mapping.sourceOffsets.length; i++) {
			const sourceStart = mapping.sourceOffsets[i];
			if (offset >= sourceStart && offset < sourceStart + mapping.lengths[i]) {
				const generatedLength = mapping.generatedLengths?.[i] ?? mapping.lengths[i];
				return mapping.generatedOffsets[i] + Math.min(offset - sourceStart, generatedLength - 1);
			}
		}
	}
	return offset;
}

function unusedCssForFile(fileName: string): ts.Diagnostic[] {
	return getUnusedCssDiagnostics(fileName, ts, readSourceFile)
		.map(d => d.start === undefined ? d : { ...d, start: toGenerated(fileName, d.start) });
}

function patchLanguageService(ls: ts.LanguageService): void {
	// The hover rewriter calls back into the ORIGINAL quickinfo/definition
	// (see getQuickInfoWithDarTsxKeywords); hand it a facade that restores
	// the unpatched method instead of the patched ls, or we recurse forever.
	const originalQuickInfo = ls.getQuickInfoAtPosition.bind(ls);
	const baseService: ts.LanguageService = new Proxy(ls, {
		get(target, prop, receiver) {
			if (prop === 'getQuickInfoAtPosition') return originalQuickInfo;
			return Reflect.get(target, prop, receiver);
		},
	});
	ls.getQuickInfoAtPosition = (fileName, position) =>
		getQuickInfoWithDarTsxKeywords(baseService, fileName, position, readSourceFile, quickInfoToSource);

	// Diagnostics flow both through the LS methods and — as the volar
	// semantic plugin prefers — through program.get*Diagnostics(sourceFile);
	// patch both, mirroring the desktop tsserver plugin's Proxy.
	for (const method of ['getSyntacticDiagnostics', 'getSemanticDiagnostics', 'getSuggestionDiagnostics'] as const) {
		const original = ls[method];
		const patched: (fileName: string) => ts.Diagnostic[] = fileName => {
			const diags = original.call(ls, fileName);
			return filterForFile(fileName)?.(diags) ?? diags;
		};
		(ls as unknown as Record<typeof method, typeof patched>)[method] = patched;
	}

	const originalGetProgram = ls.getProgram.bind(ls);
	ls.getProgram = () => {
		const program = originalGetProgram();
		if (!program) return program;
		return new Proxy(program, {
			get(target, prop, receiver) {
				if (prop === 'getSemanticDiagnostics' || prop === 'getSyntacticDiagnostics' || prop === 'getDeclarationDiagnostics') {
					const original = target[prop];
					return (sourceFile?: ts.SourceFile, ...rest: unknown[]) => {
						const diags = (original as (...args: unknown[]) => ts.Diagnostic[]).call(target, sourceFile, ...rest);
						if (!sourceFile) return diags;
						const filtered = filterForFile(sourceFile.fileName)?.(diags) ?? diags;
						// Unused-CSS warnings ride the semantic flow only — the same
						// place the desktop tsserver plugin appends them.
						return prop === 'getSemanticDiagnostics'
							? [...filtered, ...unusedCssForFile(sourceFile.fileName)]
							: filtered;
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});
	};
}

// ── message handling ────────────────────────────────────────────────

// WorkerLanguageService's method surface (see @volar/monaco/worker.js) —
// the dispatch whitelist.
const METHODS = new Set([
	'getSemanticTokenLegend', 'getCommands', 'getTriggerCharacters',
	'getAutoFormatTriggerCharacters', 'getSignatureHelpTriggerCharacters', 'getSignatureHelpRetriggerCharacters',
	'executeCommand', 'getDocumentFormattingEdits', 'getFoldingRanges', 'getSelectionRanges',
	'getLinkedEditingRanges', 'getDocumentSymbols', 'getDocumentColors', 'getColorPresentations',
	'getDiagnostics', 'getWorkspaceDiagnostics', 'getReferences', 'getFileReferences',
	'getDefinition', 'getTypeDefinition', 'getImplementations', 'getRenameRange', 'getRenameEdits',
	'getFileRenameEdits', 'getSemanticTokens', 'getHover', 'getCompletionItems', 'getCodeActions',
	'getSignatureHelp', 'getCodeLenses', 'getDocumentHighlights', 'getDocumentLinks',
	'getWorkspaceSymbols', 'getAutoInsertSnippet', 'getDocumentDropEdits', 'getInlayHints',
	'resolveCodeAction', 'resolveCompletionItem', 'resolveCodeLens', 'resolveDocumentLink',
	'resolveInlayHint', 'resolveWorkspaceSymbol', 'getCallHierarchyItems',
	'getCallHierarchyIncomingCalls', 'getCallHierarchyOutgoingCalls',
	'cancelRequest', 'dispose',
]);

async function handle(message: WorkerInbound): Promise<void> {
	if (message.type === 'init') {
		compilerOptionsJson = message.compilerOptions;
		buildService();
		post({ type: 'ready' });
		return;
	}

	if (message.type === 'sync') {
		mirrors.clear();
		for (const model of message.models) {
			mirrors.set(model.uri, { uri: URI.parse(model.uri), version: model.version, text: model.text });
		}
		post({ type: 'synced' });
		return;
	}

	if (message.type === 'cancel') {
		service?.cancelRequest(message.id);
		return;
	}

	if (message.type === 'request') {
		const { id, method, args } = message;
		try {
			if (!service) throw new Error('language service not initialized');
			if (!METHODS.has(method)) throw new Error(`unknown method: ${method}`);
			const fn = (service as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
			const result = await fn.call(service, ...args);
			post({ type: 'response', id, result });
		} catch (error) {
			console.error('[dartsx-worker] request failed', method, error instanceof Error ? error.message : String(error));
			post({ type: 'response', id, error: error instanceof Error ? error.message : String(error) });
		}
	}
}

// Boot: fetch the d.ts payload before anything can build the service.
// Messages arriving mid-boot are queued (assigning onmessage synchronously
// guarantees nothing is dropped) and replayed once ready.
const inbox: WorkerInbound[] = [];
let booted = false;

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
	if (!booted) {
		inbox.push(event.data);
		return;
	}
	void handle(event.data);
};

void (async () => {
	try {
		await loadVirtualFs();
	} catch (error) {
		console.error('[dartsx-worker] boot failed', error);
		return;
	}
	booted = true;
	for (const message of inbox.splice(0)) {
		void handle(message);
	}
})();

function post(message: WorkerOutbound): void {
	(self as unknown as Worker).postMessage(message);
}
