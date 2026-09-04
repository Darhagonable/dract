// DarTsx language worker: TypeScript language features for the playground.
//
// The vue-repl worker shape on monaco-editor-core's native worker protocol:
// the main thread (./index.ts) boots us via MonacoEnvironment.getWorker and
// waits for the 'dartsx-ready' gate before handing the worker to monaco, so
// monaco's $initialize handshake only flows once the d.ts payload (fetched at
// boot, see ./virtual-fs.ts) is mounted.
//
// Inside: createTypeScriptWorkerLanguageService from @volar/monaco/worker +
// the DarTsx post-processing from @dartsx/language-service — the same
// diagnostic filter, unused-CSS warnings and hover keyword rewriting the
// desktop tsserver plugin applies. TypeScript itself and the dartsx runtime
// .d.ts files are bundled in, so type checking works offline.

import * as monacoWorker from 'monaco-editor-core/esm/vs/editor/editor.worker';
import * as ts from 'typescript';
import { URI } from 'vscode-uri';
import { createTypeScriptWorkerLanguageService } from '@volar/monaco/worker';
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

/** The slice of monaco's worker context the service uses. */
interface MirrorModel {
	uri: URI;
	version: number;
	getValue(): string;
}

interface WorkerContext {
	getMirrorModels(): MirrorModel[];
}

let workerContext: WorkerContext | null = null;
let languageRef: Language | undefined;

function readSourceFile(fileName: string): string | undefined {
	const uri = URI.file(fileName).toString();
	const model = workerContext?.getMirrorModels().find(mirror => mirror.uri.toString() === uri);
	if (model) return model.getValue();
	return virtualFs.readFile(fileName);
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

// ── boot ────────────────────────────────────────────────────────────

void (async () => {
	try {
		await loadVirtualFs();
	} catch (error) {
		console.error('[dartsx-worker] boot failed', error);
		postMessage('dartsx-error');
		return;
	}

	monacoWorker.initialize((context: WorkerContext, createData: { compilerOptions: Record<string, unknown> | null }) => {
		workerContext = context;
		const converted = ts.convertCompilerOptionsFromJson(createData.compilerOptions ?? {}, '/tmp/project');
		const compilerOptions: ts.CompilerOptions = {
			...converted.options,
			allowNonTsExtensions: true,
		};
		for (const diagnostic of converted.errors) {
			console.warn('[dartsx-worker] tsconfig:', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
		}

		// ts.sys is undefined in a browser worker. createSys keys off the mere
		// PRESENCE of `sys` to route resolvePath through sys.resolvePath /
		// sys.directoryExists, so the stub must provide both (real existence
		// checks go through env.fs/virtualFs, not these).
		const stubSys = {
			useCaseSensitiveFileNames: true,
			resolvePath: (fsPath: string) => (fsPath.startsWith('/') ? fsPath : `/${fsPath}`),
			directoryExists: () => true,
		} as unknown as typeof ts.sys;

		return createTypeScriptWorkerLanguageService({
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
			workerContext: context as never,
			languagePlugins: [
				getDarTsxLanguagePlugin(readSourceFile),
			],
			languageServicePlugins: makePlugins(),
		});
	});

	postMessage('dartsx-ready');
})();
