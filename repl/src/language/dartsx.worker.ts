// DarTsx language worker: TypeScript language features for the playground.
//
// monaco-editor-core's native worker protocol on the inside,
// @volar/monaco's TypeScript worker service around our language plugin —
// the same @dartsx/language-service the desktop tooling uses, applied at
// the same LanguageService seam the tsserver plugin patches: diagnostic
// filtering, hover keyword rewriting, unused-CSS warnings.
//
// Boot order (enforced by monaco-env.ts's ready gate): mount the offline
// d.ts payload, then initialize, then post 'dartsx-ready'.

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
import { loadVirtualFs, virtualFs } from './virtual-fs';

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
	const model = workerContext?.getMirrorModels().find((mirror) => mirror.uri.toString() === uri);
	if (model) return model.getValue();
	return virtualFs.readFile(fileName);
}

// ── DarTsx post-processing (same rules as the desktop tsserver plugin) ──
// All helpers come from @dartsx/language-service and work in generated
// (preprocessed) offsets, so they must run below volar's source mapping.

function toSource(fileName: string, offset: number): number {
	const root = languageRef?.scripts.get(URI.file(fileName))?.generated?.root;
	if (!(root instanceof DarTsxVirtualCode)) return offset;
	for (const mapping of root.mappings) {
		const lengths = mapping.generatedLengths ?? mapping.lengths;
		for (let i = 0; i < mapping.generatedOffsets.length; i++) {
			const start = mapping.generatedOffsets[i];
			if (offset >= start && offset < start + lengths[i]) {
				return mapping.sourceOffsets[i] + (offset - start);
			}
		}
	}
	return offset;
}

function toGenerated(fileName: string, offset: number): number {
	const root = languageRef?.scripts.get(URI.file(fileName))?.generated?.root;
	if (!(root instanceof DarTsxVirtualCode)) return offset;
	for (const mapping of root.mappings) {
		for (let i = 0; i < mapping.sourceOffsets.length; i++) {
			const start = mapping.sourceOffsets[i];
			if (offset >= start && offset < start + mapping.lengths[i]) {
				const generatedLength = mapping.generatedLengths?.[i] ?? mapping.lengths[i];
				return mapping.generatedOffsets[i] + Math.min(offset - start, generatedLength - 1);
			}
		}
	}
	return offset;
}

function filterForFile(fileName: string) {
	return (diags: ts.Diagnostic[]) =>
		filterDarTsxDiagnostics(diags, fileName, readSourceFile, (file, offset) => toSource(file, offset));
}

function unusedCssForFile(fileName: string): ts.Diagnostic[] {
	// Unused-CSS warnings are computed in source offsets; translate them to
	// generated offsets so volar's mapping above lands them on the source.
	return getUnusedCssDiagnostics(fileName, ts, readSourceFile)
		.map((d) => (d.start === undefined ? d : { ...d, start: toGenerated(fileName, d.start) }));
}

function patchLanguageService(ls: ts.LanguageService): void {
	// The hover rewriter calls back into the ORIGINAL quick info; hand it a
	// facade restoring the unpatched method or it recurses forever.
	const originalQuickInfo = ls.getQuickInfoAtPosition.bind(ls);
	const baseService: ts.LanguageService = new Proxy(ls, {
		get(target, prop, receiver) {
			if (prop === 'getQuickInfoAtPosition') return originalQuickInfo;
			return Reflect.get(target, prop, receiver);
		},
	});
	ls.getQuickInfoAtPosition = (fileName, position) =>
		getQuickInfoWithDarTsxKeywords(baseService, fileName, position, readSourceFile, (file, offset) => toSource(file, offset));

	for (const method of ['getSyntacticDiagnostics', 'getSemanticDiagnostics', 'getSuggestionDiagnostics'] as const) {
		const original = ls[method];
		const patched: (fileName: string) => ts.Diagnostic[] = (fileName) => {
			const diags = original.call(ls, fileName);
			return filterForFile(fileName)?.(diags) ?? diags;
		};
		(ls as unknown as Record<typeof method, typeof patched>)[method] = patched;
	}

	// Diagnostics also flow through program.get*Diagnostics (the volar
	// semantic plugin prefers that path) — patch both.
	const originalGetProgram = ls.getProgram.bind(ls);
	ls.getProgram = () => {
		const program = originalGetProgram();
		if (!program) return program;
		return new Proxy(program, {
			get(target, prop, receiver) {
				if (
					prop === 'getSemanticDiagnostics' ||
					prop === 'getSyntacticDiagnostics' ||
					prop === 'getDeclarationDiagnostics'
				) {
					const original = target[prop];
					return (sourceFile?: ts.SourceFile, ...rest: unknown[]) => {
						const diags = (original as (...args: unknown[]) => ts.Diagnostic[]).call(
							target,
							sourceFile,
							...rest,
						);
						if (!sourceFile) return diags;
						const filtered = filterForFile(sourceFile.fileName)?.(diags) ?? diags;
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

function makePlugins() {
	const semantic = createSemanticPlugin(ts);
	const originalCreate = semantic.create.bind(semantic);
	semantic.create = (context) => {
		languageRef ??= context.language;
		const created = originalCreate(context);
		const ls = created.provide?.['typescript/languageService']?.() as ts.LanguageService | undefined;
		if (ls) patchLanguageService(ls);
		return created;
	};
	return [semantic, createDirectiveCommentPlugin()];
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

	monacoWorker.initialize(
		(context: WorkerContext, createData: { compilerOptions: Record<string, unknown> | null }) => {
			workerContext = context;
			const converted = ts.convertCompilerOptionsFromJson(createData.compilerOptions ?? {}, '/project');
			const compilerOptions: ts.CompilerOptions = {
				...converted.options,
				allowNonTsExtensions: true,
			};
			for (const diagnostic of converted.errors) {
				console.warn('[dartsx-worker] tsconfig:', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
			}

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
					asFileName: (uri) => uri.path,
					asUri: (fileName) => URI.file(fileName),
				},
				workerContext: context as never,
				languagePlugins: [getDarTsxLanguagePlugin(readSourceFile)],
				languageServicePlugins: makePlugins(),
			});
		},
	);

	postMessage('dartsx-ready');
})();
