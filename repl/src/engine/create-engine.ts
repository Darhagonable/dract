// The playground engine — the framework-free ORCHESTRATION of the kernel.
// This file is a table of contents: it creates the pieces, wires them
// together, and exposes state + commands. The implementations live elsewhere:
//
//   kernel/workspace.ts        the user's project (files + entry)
//   kernel/compiler.ts         the Compiler boundary (oxc/dartsx Project;
//                              swappable for a worker client later)
//   kernel/bundler.ts          module graph for the sandbox
//   kernel/runtime/            sandboxed-iframe preview + CDP relay
//   kernel/serialization.ts    share-link encode/decode/consent bookkeeping
//   editor/editor-stack.ts     CodeMirror views, per-file state, theming
//   engine/output-pane.ts      compiled code/AST pane presenter
//   features/ts-language/      LSP worker session + document sync
//   features/ast-inspector/    AST tree pane + source↔output mapping
//
// It knows nothing about React: the UI layer creates it with a set of host
// elements, subscribes to its state, and drives it through `commands`.
//
// Flow: an edit lands in workspace.updateFile() → debounced compile →
// BuildResult → preview.run() | output-pane refresh | TS type sync. Shared
// links are UNTRUSTED input: a hash payload is decoded and compiled (pure
// string work) but does NOT execute until the visitor presses "Run" on the
// consent overlay. Your own edits auto-run as before.
import type { Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { shikiHighlight } from '../editor/shiki-codemirror.ts';
import { EditorStack, OUTPUT_PLACEHOLDER } from '../editor/editor-stack.ts';
import { OutputPane } from './output-pane.ts';
import { clearMappedIn, mappedField, revealRanges } from '../editor/mapping-marks.ts';
import { createPreview, type PlaygroundOutputTarget, type Preview } from '../kernel/runtime/preview.ts';
import {
	ShareLink,
	MAX_PLAYGROUND_SOURCE_LENGTH,
	PLAYGROUND_SOURCE_LIMIT_ERROR,
} from '../kernel/serialization.ts';
import { ProjectCompiler } from '../kernel/compiler.ts';
import {
	buildModuleGraph,
	parsePlaygroundTsconfig,
} from '../kernel/bundler.ts';
import { isTsconfigFile } from '../kernel/types.ts';
import { createAstPreview, type AstPreviewController } from '../features/ast-inspector/ast-preview.ts';
import { createTypescriptSession, type TypescriptSession } from '../features/ts-language/typescript-session.ts';
import { TsDocumentSync, uriFor } from '../features/ts-language/document-sync.ts';
import { typescript, typescriptLspExtras, typescriptLspTheme } from '../features/ts-language/typescript-lsp.ts';
import * as pgExamples from '../kernel/examples.ts';
import { Workspace, nextFreeFileName } from '../kernel/workspace.ts';

const { CUSTOM_EXAMPLE_ID, DEFAULT_EXAMPLE_ID } = pgExamples;

const HASH_DEBOUNCE_MS = 400;
const COMPILE_DEBOUNCE_MS = 250;

// Server and Types are placeholders: DarTsx has no such emits yet. The
// targets stay so a future emit lands in the same pane; the placeholder text
// is deliberately a status line, not an error.
const SERVER_OUTPUT_NOTE =
	'// Server rendering is not available yet.\n' +
	'// DarTsx compiles one client runtime; a server emit is planned.';
const TYPES_OUTPUT_NOTE =
	'// Type declarations are not generated yet.\n' +
	'// DarTsx compiles TypeScript directly to JavaScript; a .d.ts emit is planned.';

/** The DOM elements the engine mounts into (the UI layer owns them). */
export interface EngineHosts {
	source: HTMLDivElement;
	output: HTMLDivElement;
	ast: HTMLDivElement;
	preview: HTMLDivElement;
	devtools: HTMLDivElement | null;
}

/**
 * The narrow channel back to the UI. Everything the engine must know about
 * transient UI state, or must ask the UI to do, goes through here — the
 * engine never imports React.
 */
export interface UiBridge {
	/** Synchronous mobile-pane mirror (read from CM event handlers). */
	isResultPaneVisible(): boolean;
	/** The active tab's live name input should show this value. */
	onInputValue(value: string): void;
}

/** The slice of state the UI renders. Replaced wholesale on every change. */
export interface EngineState {
	error: string;
	ready: boolean;
	formatting: boolean;
	/** True while a hash-shared payload is loaded but not yet approved to run. */
	gated: boolean;
	exampleId: string;
	files: string[];
	activeFile: string;
	entryFile: string;
	/** A fresh tab focuses its name input; bumped by addFile. */
	focusInputSignal: number;
}

export type ResultMode = {
	view: 'preview' | 'compiled';
	mode: 'code' | 'ast';
	target: PlaygroundOutputTarget;
};

/** Imperative verbs the UI calls. Populated once the stack has booted. */
export interface PlaygroundCommands {
	selectExample?(id: string): void;
	selectFile?(name: string): void;
	addFile?(): void;
	removeFile?(name: string): void;
	renameFile?(oldName: string, nextName: string): void;
	moveFile?(fromName: string, toName: string): void;
	formatActive?(): void;
	approveRun?(): void;
	syncOutput?(): void;
	revealAst?(): void;
	ensureDevtools?(): void;
	/**
	 * The workspace's parsed tsconfig.json (Vue-REPL `getTsConfig` contract):
	 * the raw parsed JSON, or null when missing or malformed.
	 */
	getTsConfig?(): Record<string, unknown> | null;
}

export interface PlaygroundEngineInstance {
	state: EngineState;
	/** The compiled-pane mode mirror — the UI mutates it, then calls syncOutput. */
	mode: ResultMode;
	commands: PlaygroundCommands;
	subscribe(listener: () => void): () => void;
	dispose(): void;
}

export function createPlaygroundEngine(hosts: EngineHosts, ui: UiBridge): PlaygroundEngineInstance {
	let disposed = false;
	let astPreview!: AstPreviewController;
	let preview!: Preview;
	let tsSessionInstance: TypescriptSession | null = null;
	let tsSyncInstance: TsDocumentSync | null = null;
	let editorInstance: EditorStack | null = null;
	let themeObserverRef: MutationObserver | null = null;
	let themeDebounceRef = 0;
	let compileDebounceId = 0;
	let hashDebounceId = 0;

	const listeners = new Set<() => void>();
	let state: EngineState = {
		error: '',
		ready: false,
		formatting: false,
		gated: false,
		exampleId: DEFAULT_EXAMPLE_ID,
		files: [],
		activeFile: '',
		entryFile: '',
		focusInputSignal: 0,
	};
	const patch = (partial: Partial<EngineState>) => {
		state = { ...state, ...partial };
		for (const listener of [...listeners]) listener();
	};
	const mode: ResultMode = { view: 'preview', mode: 'code', target: 'client' };
	const commands: PlaygroundCommands = {};

	// Validate the URL payload before booting the editor stack or the
	// compiler. Oversized input is ignored in favor of the bounded defaults.
	const shareLink = new ShareLink();
	const rawHash = shareLink.readCurrentHash();
	const hashResult = shareLink.decode(rawHash);
	const initial = hashResult.ok ? hashResult.value : null;
	const initialDiagnostic = hashResult.ok ? '' : hashResult.error;
	if (initialDiagnostic) patch({ error: initialDiagnostic });

	void (async () => {
		if (disposed) return;

		// The compiler owns every .tsx/.ts artifact; the bundler consumes it
		// and the compiled pane reads per-file outputs through the same
		// boundary (swappable for a worker client later without UI changes).
		const compiler = new ProjectCompiler();

		let currentExampleId: string = initial ? CUSTOM_EXAMPLE_ID : DEFAULT_EXAMPLE_ID;
		const workspace = new Workspace(pgExamples.DEFAULT_WORKSPACE);
		// A hash payload is someone else's code — display + compile it, but
		// gate EXECUTION behind the consent overlay's Run button. Two payloads
		// carry nothing new and stay ungated: one byte-equal to the default
		// workspace, and one this tab wrote itself (the ShareLink record —
		// your own work surviving a reload or route remount).
		let executionGated = false;
		if (initial) {
			workspace.load({ entry: initial.entry, files: initial.files });
			const fallback = pgExamples.DEFAULT_WORKSPACE;
			const isDefault =
				initial.files.length === 1 && initial.entry === fallback.entry &&
				initial.files[0].name === fallback.files[0].name &&
				initial.files[0].source === fallback.files[0].source;
			if (isDefault) {
				currentExampleId = DEFAULT_EXAMPLE_ID;
			} else if (shareLink.isOwnWork(rawHash)) {
				const exampleId = shareLink.readOwn()!.exampleId;
				currentExampleId = pgExamples.getExample(exampleId)
					? exampleId
					: CUSTOM_EXAMPLE_ID;
			} else {
				executionGated = true;
				patch({ gated: true });
			}
		}
		workspace.ensureTsconfig(pgExamples.SHARED_TSCONFIG_SOURCE);
		let currentFile = workspace.entry;

		const fileSource = (name: string): string => workspace.source(name);

		const publishWorkspaceState = () => {
			patch({
				exampleId: currentExampleId,
				files: workspace.files.map((file) => file.name),
				activeFile: currentFile,
				entryFile: workspace.entry,
			});
		};

		// The repl's theme toggle lives in main.ts and only flips the
		// data-theme attribute — observe it rather than threading UI state;
		// the editor stack owns re-theming its views.
		themeObserverRef = new MutationObserver(() => {
			window.clearTimeout(themeDebounceRef);
			themeDebounceRef = window.setTimeout(() => {
				if (!disposed) editorInstance?.applyTheme();
			}, 0);
		});
		themeObserverRef.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

		preview = createPreview(hosts.preview, (message: string) => {
			if (!disposed) patch({ error: message });
		}, hosts.devtools);

		// ── TypeScript intellisense (LSP over a worker) ─────────────────
		// One session for every file's EditorState: the worker runs the TS
		// language service against preprocessed DarTsx, lsp-client renders
		// hover/completions/signature/jump-to-def, and the linter paints
		// diagnostics. Everything no-ops if the session failed to spawn — the
		// playground stays fully usable without it. Workspace→session
		// synchronization lives in features/ts-language/document-sync.ts.
		let tsSession: TypescriptSession | null = null;
		try {
			tsSession = createTypescriptSession();
			tsSessionInstance = tsSession;
		} catch {
			tsSession = null;
		}
		const tsSync = new TsDocumentSync(tsSession, {
			getFiles: () => workspace.files,
			getActiveFile: () => currentFile,
			getViews: () =>
				editorInstance ? [editorInstance.sourceView, editorInstance.outputView] : [],
			isDisposed: () => disposed,
		});
		tsSyncInstance = tsSync;
		const lintExtension: Extension[] = tsSync.lintExtension();

		// ── Compiled pane presenter ──────────────────────────────────────
		// Artifact cache, mapping/AST staleness, and pane refresh live in
		// engine/output-pane.ts; the engine wires it to the editor stack and
		// the AST inspector and drives it from compile/sync paths.
		astPreview = createAstPreview(hosts.ast, {
			onNodeRange: (range, scroll) => outputPane.revealAstRange(range, scroll),
		});

		const outputPane = new OutputPane({
			compiler,
			mode,
			initialOutputDoc: OUTPUT_PLACEHOLDER,
			getActiveFile: () => currentFile,
			getSource: fileSource,
			reportError: (message) => patch({ error: message }),
			clearMapped: (side) => editor.clearMapped(side),
			setOutputDoc: (code) => editor.setOutputDoc(code),
			revealRanges: (view, ranges, scroll) => revealRanges(view, ranges, scroll),
			views: () =>
				editorInstance ? { source: editorInstance.sourceView, output: editorInstance.outputView } : null,
			ast: () => astPreview ?? null,
		});

		const showOutput = () => outputPane.showOutput();

		const crossNavigate = (side: 'source' | 'output') => EditorView.updateListener.of((
			update: ViewUpdate,
		) => {
			if (!update.selectionSet || update.docChanged) return;
			// Only user-driven cursor moves navigate — programmatic dispatches
			// (doc replacement, highlight effects) must not feed back.
			if (!update.transactions.some((tr) => tr.isUserEvent('select'))) return;
			if (mode.view !== 'compiled') return;
			const offset = update.state.selection.main.head;
			if (mode.mode === 'ast') {
				if (outputPane.activeAst()) astPreview.reveal(offset, true);
				return;
			}
			const pair = outputPane.pairFor(side, offset);
			// Marks reflect the CURRENT selection — an unmapped one clears.
			if (pair) outputPane.revealPair(pair, side === 'source' ? 'output' : 'source');
			else outputPane.clearPair();
		});

		// Hovering either document highlights the corresponding ranges without moving its scroll
		// position; clicking/cursor movement above additionally reveals them.
		const crossHover = (side: 'source' | 'output') => EditorView.domEventObservers({
			mousemove(event: MouseEvent, view: EditorView) {
				if (mode.view !== 'compiled') return;
				const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
				if (mode.mode === 'ast') {
					if (offset == null || !outputPane.activeAst()) outputPane.clearPair();
					else astPreview.reveal(offset, false);
					return;
				}
				const pair =
					offset == null ? null : outputPane.pairFor(side, offset);
				if (pair) outputPane.revealPair(pair, null);
				else outputPane.clearPair();
			},
			mouseleave() {
				// The browser can deliver mouseleave before the mobile pane's
				// display:none reaches layout. The synchronous pane ref makes
				// that stale event harmless from the instant Inspect is clicked.
				if (side === 'source' && ui.isResultPaneVisible()) return;
				outputPane.clearPair();
				astPreview.clear();
			},
		});


		let compileSeq = 0;
		const compileAndRun = async () => {
			if (disposed) return;
			const seq = ++compileSeq;
			// Keep the TS worker's document set in lockstep with the workspace.
			// Boot and every structural change (example switch, add/remove/
			// rename) flow through here; typing flows through the update
			// listener. Without this, sibling files are never opened in the
			// worker and their imports resolve as missing modules.
			tsSync.syncFiles();
			const total = workspace.totalLength();
			if (total > MAX_PLAYGROUND_SOURCE_LENGTH) {
				patch({ error: PLAYGROUND_SOURCE_LIMIT_ERROR });
				return;
			}
			const graph = await buildModuleGraph(compiler, workspace.files, workspace.entry);
			if (disposed || seq !== compileSeq) return;
			// The compiled pane describes the active source file, independently
			// of whether another workspace file prevents the runnable module
			// graph from compiling. Refresh it before handling graph failure.
			const outputError = showOutput();
			if (!graph.ok) {
				outputPane.setGraphError(graph.error);
				patch({ error: graph.error });
				return;
			}
			outputPane.setGraphError('');
			patch({ error: outputError || '' });
			// New externals in the graph → fetch their declaration files and
			// re-lint once the worker's environment is rebuilt.
			tsSync.syncTypesFor(graph);
			// While a shared payload is gated, everything except EXECUTION
			// happens — the visitor can inspect source and compiled output.
			if (executionGated) return;
			void preview.run(graph).then((r: { error: string | null }) => {
				if (!disposed && r.error) patch({ error: r.error ?? '' });
			});
		};

		const scheduleCompile = () => {
			window.clearTimeout(compileDebounceId);
			compileDebounceId = window.setTimeout(() => {
				void compileAndRun();
			}, COMPILE_DEBOUNCE_MS);
		};

		// While a shared payload is still gated, the URL keeps the sender's
		// link untouched; otherwise the ShareLink owns encoding, history, and
		// the own-work record — the engine only decides WHEN (debounced).
		const updateHash = () => {
			window.clearTimeout(hashDebounceId);
			hashDebounceId = window.setTimeout(() => {
				if (executionGated) return;
				shareLink.publish(
					{
						lang: 'tsx',
						entry: workspace.entry,
						files: [...workspace.files],
					},
					currentExampleId,
				);
			}, HASH_DEBOUNCE_MS);
		};

		// ── Editor stack ─────────────────────────────────────────────────
		// Chrome, per-file state, and theming live in editor/editor-stack.ts;
		// the engine injects the language/inspect layers and reacts to edits.
		const acceptsEdit = (newDocLength: number): boolean => {
			const others = workspace.totalLength() - workspace.source(currentFile).length;
			if (others + newDocLength <= MAX_PLAYGROUND_SOURCE_LENGTH) return true;
			patch({ error: PLAYGROUND_SOURCE_LIMIT_ERROR });
			return false;
		};
		const editor = new EditorStack(
			{
				sourceHost: hosts.source,
				outputHost: hosts.output,
				getSource: (name) => workspace.source(name),
				acceptsEdit,
				onFormatShortcut: () => commands.formatActive?.(),
				languageExtensions: (name) => {
					const json = isTsconfigFile(name);
					return [
						// DarTsx TextMate highlighting (our VS Code extension's
						// injection grammars via Shiki) — paints what the Lezer TSX
						// grammar cannot see (component/state/derived/render/bind,
						// <style> blocks).
						shikiHighlight(json ? 'json' : 'tsx'),
						// Language features ride along only on source files — the
						// tsconfig document stays a plain JSON viewer.
						...(json || !tsSession
							? []
							: [
								typescript({ jsx: true }),
								tsSession.client.plugin(uriFor(name), 'typescript'),
								typescriptLspExtras,
								typescriptLspTheme,
							]),
						...lintExtension,
					];
				},
				outputExtensions: () => [shikiHighlight('tsx'), typescript({ jsx: true })],
				inspectExtensions: (side) => [
					mappedField,
					crossHover(side),
					crossNavigate(side),
				],
				clearInspection: (side) => {
					if (!editorInstance) return;
					clearMappedIn(side === 'source' ? editorInstance.sourceView : editorInstance.outputView);
				},
				onDocChange: (next) => {
					const view = editorInstance!.outputView;
					// The source half of the pair changed — orphan any marks still
					// shown in the output (this field self-clears; a failed
					// recompile would otherwise leave the output's marks forever).
					clearMappedIn(view);
					if (mode.mode === 'ast') {
						astPreview.setUnavailable('Waiting for the next successful compile…', currentFile);
						outputPane.resetShown();
					}
					workspace.update(currentFile, next);
					// Any edit means the buffer no longer matches the example.
					if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
						currentExampleId = CUSTOM_EXAMPLE_ID;
						patch({ exampleId: CUSTOM_EXAMPLE_ID });
					}
					scheduleCompile();
					tsSync.syncFiles();
					if (isTsconfigFile(currentFile)) tsSync.scheduleTsconfigSync();
					updateHash();
				},
			},
			currentFile,
		);
		editorInstance = editor;

		const openFile = (name: string) => {
			editor.open(name, currentFile);
			currentFile = name;
			patch({ activeFile: name });
			showOutput();
		};

		commands.selectExample = (id) => {
			if (disposed || id === CUSTOM_EXAMPLE_ID || id === currentExampleId) return;
			const example = pgExamples.getExample(id);
			if (!example) return;
			currentExampleId = id;
			// The visitor's tsconfig survives an example switch — it is
			// workspace state, not example content (Vue-REPL behavior).
			workspace.load(pgExamples.exampleWorkspace(example), { preserveTsconfig: true });
			currentFile = workspace.entry;
			editor.forgetSavedStates();
			editor.reopen(currentFile, false);
			outputPane.resetCache();
			editor.clearMapped('output');
			// Picking an example is the visitor's own action — never gated.
			executionGated = false;
			patch({ gated: false });
			publishWorkspaceState();
			window.clearTimeout(compileDebounceId);
			void compileAndRun();
			updateHash();
		};

		commands.selectFile = (name) => {
			if (disposed || name === currentFile) return;
			if (!workspace.has(name)) return;
			openFile(name);
		};

		commands.addFile = () => {
			if (disposed) return;
			const added = workspace.add(nextFreeFileName(workspace.names()));
			if (!added) return;
			// Any structural change means the buffer no longer matches the
			// example (the same flip edits perform).
			if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
				currentExampleId = CUSTOM_EXAMPLE_ID;
				patch({ exampleId: CUSTOM_EXAMPLE_ID });
			}
			openFile(added.name);
			// The new tab's name input is live (Svelte-REPL-style) — focus
			// it so the visitor can name the file right away.
			ui.onInputValue(added.name);
			patch({ focusInputSignal: state.focusInputSignal + 1 });
			publishWorkspaceState();
			window.clearTimeout(compileDebounceId);
			void compileAndRun();
			updateHash();
		};

		commands.removeFile = (name) => {
			if (disposed) return;
			// The Workspace enforces the invariants: the last file, the entry
			// (the workspace root), and the tsconfig (injected state — re-added
			// by the next boot's ensureTsconfig) cannot be deleted.
			const index = workspace.remove(name);
			if (index < 0) return;
			const wasCurrent = name === currentFile;
			// Drop the file's undo history along with the file itself.
			editor.dropSavedState(name);
			// The compile cache is keyed by file name — purge the deleted one
			// rather than churn every key. Nothing else references them.
			outputPane.invalidateFile(name);
			if (wasCurrent) {
				// Fall to the file that took the tab's place, wrapping to the
				// first when the last file was deleted.
				const next = workspace.files[Math.min(index, workspace.files.length - 1)];
				currentFile = next.name;
				editor.reopen(next.name, true);
			}
			editor.clearMapped('output');
			outputPane.resetShown();
			if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
				currentExampleId = CUSTOM_EXAMPLE_ID;
				patch({ exampleId: CUSTOM_EXAMPLE_ID });
			}
			publishWorkspaceState();
			window.clearTimeout(compileDebounceId);
			void compileAndRun();
			updateHash();
		};

		commands.renameFile = (oldName, nextName) => {
			if (disposed) return;
			// The Workspace enforces the fixed names (entry, tsconfig), trims,
			// and deconflicts; null means the rename was not allowed.
			const name = workspace.rename(oldName, nextName);
			if (!name) return;
			if (currentFile === oldName) currentFile = name;
			// The file's undo history follows it to the new key.
			editor.renameSavedState(oldName, name);
			// The compile cache is keyed by file name — drop the old key so
			// the next compile repopulates it under the new name.
			outputPane.invalidateFile(oldName);
			// A rename makes the buffer non-example, like any edit.
			if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
				currentExampleId = CUSTOM_EXAMPLE_ID;
				patch({ exampleId: CUSTOM_EXAMPLE_ID });
			}
			editor.clearMapped('source');
			editor.clearMapped('output');
			outputPane.resetShown();
			ui.onInputValue(name);
			publishWorkspaceState();
			window.clearTimeout(compileDebounceId);
			void compileAndRun();
			updateHash();
		};

		// Drag-reorder: the dropped file takes the slot the dragged file
		// was dropped on (Svelte-REPL semantics). Ordering affects nothing
		// but the hash payload, so no compile is needed.
		commands.moveFile = (fromName, toName) => {
			if (disposed) return;
			if (!workspace.move(fromName, toName)) return;
			publishWorkspaceState();
			updateHash();
		};

		commands.formatActive = () => {
			if (disposed) return;
			patch({ formatting: true });
			void (async () => {
				try {
					const { formatPlaygroundFile } = await import('../features/formatter/format.ts');
					const source = editor.sourceView.state.doc.toString();
					const result = await formatPlaygroundFile(currentFile, source);
					if (disposed) return;
					if (!result.ok) {
						patch({ error: result.error });
						return;
					}
					if (result.code !== source) editor.replaceDoc(editor.sourceView, result.code);
				} finally {
					if (!disposed) patch({ formatting: false });
				}
			})();
		};

		commands.approveRun = () => {
			if (disposed || !executionGated) return;
			executionGated = false;
			patch({ gated: false });
			void compileAndRun();
			// The approved code is the visitor's own now — record it so a
			// reload doesn't re-gate it.
			updateHash();
		};

		commands.syncOutput = () => {
			if (disposed) return;
			if (mode.view === 'compiled') {
				showOutput();
				return;
			}
			// Leaving the compiled view: marks pair with a pane no longer shown.
			editor.clearMapped('source');
			editor.clearMapped('output');
		};
		commands.ensureDevtools = () => {
			if (disposed) return;
			preview.ensureDevtools();
		};
		commands.getTsConfig = () => parsePlaygroundTsconfig(workspace.files);
		commands.revealAst = () => {
			if (disposed || !outputPane.activeAst()) return;
			astPreview.reveal(editor.sourceView.state.selection.main.head, true);
		};

		publishWorkspaceState();
		// Seed the TypeScript worker with the workspace + its compiler
		// options; the first compileAndRun below also feeds it externals.
		tsSync.scheduleTsconfigSync();
		void compileAndRun();
		if (initialDiagnostic) patch({ error: initialDiagnostic });
		patch({ ready: true });
	})();

	return {
		get state() {
			return state;
		},
		mode,
		commands,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			window.clearTimeout(compileDebounceId);
			window.clearTimeout(hashDebounceId);
			window.clearTimeout(themeDebounceRef);
			themeObserverRef?.disconnect();
			tsSyncInstance?.dispose();
			tsSessionInstance?.dispose();
			editorInstance?.destroy();
			astPreview?.destroy();
			preview?.destroy();
		},
	};
}
