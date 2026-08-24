// The playground engine — the framework-free composition of the kernel.
//
// This module OWNS the interactive stack: the Workspace, the Compiler, the
// sandboxed preview, the CodeMirror views, the AST inspector, and the
// TypeScript language session. It knows nothing about React: the UI layer
// creates it with a set of host elements, subscribes to its state, and drives
// it through `commands`.
//
// The whole pipeline runs in the browser: the `dartsx` compiler (oxc-parser/
// oxc-transform WASM bindings + esrap — no Node APIs) compiles the virtual
// files on a debounce, the module graph executes inside a SANDBOXED IFRAME
// with an opaque origin (see kernel/runtime/ — never in this page), and
// CodeMirror is themed and syntax-highlighted exactly like solid-repl:
// editor/themes.ts paints the chrome AND every token through its Lezer
// highlight styles. The TypeScript language layer lives in its own worker
// chunk (features/ts-language/) — only its small client half is bundled here.
//
// Shared links are UNTRUSTED input: a hash payload is decoded into the editor
// and compiled (source + compiled output are safe to display — compilation is
// pure string work), but it does NOT execute — even in the sandbox — until the
// visitor explicitly presses "Run" on the consent overlay. Your own edits from
// the default sources auto-run as before.
import {
	Compartment,
	EditorState,
	StateEffect,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	keymap,
	lineNumbers,
	type ViewUpdate,
} from '@codemirror/view';
import { linter, lintGutter } from '@codemirror/lint';
import { darkHighlightStyle, darkTheme, lightHighlightStyle, lightTheme } from '../editor/themes.ts';
import { shikiHighlight } from '../editor/shiki-codemirror.ts';
import { clearMappedIn, mappedField, revealRanges } from '../editor/mapping-marks.ts';
import { codeFolding, foldGutter, syntaxHighlighting } from '@codemirror/language';
import { createPreview, type PlaygroundOutputTarget, type Preview } from '../kernel/runtime/preview.ts';
import { mappingFromSourceMap, type CodeMapping } from '../features/ast-inspector/mapping.ts';
import {
	decodePlaygroundHash,
	encodePlaygroundHash,
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
import { typescript, typescriptLspExtras, typescriptLspTheme } from '../features/ts-language/typescript-lsp.ts';
import * as pgExamples from '../kernel/examples.ts';
import { Workspace, nextFreeFileName } from '../kernel/workspace.ts';

const { CUSTOM_EXAMPLE_ID, DEFAULT_EXAMPLE_ID } = pgExamples;

const HASH_DEBOUNCE_MS = 400;
const COMPILE_DEBOUNCE_MS = 250;

const AST_TARGET_META: Record<PlaygroundOutputTarget, { label: string; notice: string }> = {
	client: {
		label: 'Client output AST',
		notice: 'The compiled client Program, as the transform left it. Tap a node to pin its highlight.',
	},
	server: {
		label: 'Server output AST',
		notice: 'No server emit yet — DarTsx compiles one client runtime for now.',
	},
	types: {
		label: 'Types output AST',
		notice: 'No types emit yet — DarTsx compiles TypeScript directly to JavaScript.',
	},
};

export const OUTPUT_TARGET_LABEL: Record<PlaygroundOutputTarget, string> = {
	client: 'Client',
	server: 'Server',
	types: 'Types',
};

// Server and Types are placeholders: DarTsx has no such emits yet. The
// targets stay so a future emit lands in the same pane; the placeholder text
// is deliberately a status line, not an error.
const SERVER_OUTPUT_NOTE =
	'// Server rendering is not available yet.\n' +
	'// DarTsx compiles one client runtime; a server emit is planned.';
const TYPES_OUTPUT_NOTE =
	'// Type declarations are not generated yet.\n' +
	'// DarTsx compiles TypeScript directly to JavaScript; a .d.ts emit is planned.';

// sessionStorage record of the last hash THIS tab wrote (plus the example it
// came from). A payload matching it is the visitor's own work surviving a
// reload or route remount — restored without the shared-code consent gate.
// sessionStorage is same-origin and per-tab, so a link someone sends can never
// pre-seed it.
const OWN_HASH_STORAGE_KEY = 'octane-playground-own-hash';

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
	let sourceView!: EditorView;
	let outputView!: EditorView;
	let astPreview!: AstPreviewController;
	let preview!: Preview;
	let tsSessionInstance: TypescriptSession | null = null;
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
	const rawHash = window.location.hash.slice(1);
	const hashResult = decodePlaygroundHash(rawHash);
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
		// workspace, and one this tab wrote itself (the sessionStorage record —
		// your own work surviving a reload or route remount).
		const readOwnHash = (): { hash: string; exampleId: string } | null => {
			try {
				const stored = window.sessionStorage.getItem(OWN_HASH_STORAGE_KEY);
				if (!stored) return null;
				const parsed = JSON.parse(stored);
				return typeof parsed?.hash === 'string' && typeof parsed?.exampleId === 'string'
					? parsed
					: null;
			} catch {
				return null;
			}
		};
		let executionGated = false;
		if (initial) {
			workspace.load({ entry: initial.entry, files: initial.files });
			const fallback = pgExamples.DEFAULT_WORKSPACE;
			const isDefault =
				initial.files.length === 1 && initial.entry === fallback.entry &&
				initial.files[0].name === fallback.files[0].name &&
				initial.files[0].source === fallback.files[0].source;
			const own = readOwnHash();
			if (isDefault) {
				currentExampleId = DEFAULT_EXAMPLE_ID;
			} else if (own && own.hash === rawHash) {
				currentExampleId = pgExamples.getExample(own.exampleId)
					? own.exampleId
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

		// ── Editor theming, exactly solid-repl's architecture ────────────
		// editor/themes.ts owns everything: per-theme editor chrome plus the
		// Lezer highlight styles that paint ALL editor tokens. The active pair
		// is mounted through Compartments and reconfigured when the page's
		// data-theme flips (see the MutationObserver below).
		const isDark = (): boolean =>
			document.documentElement.getAttribute('data-theme') !== 'light';
		const themeExtensions = (): Extension[] => [
			isDark() ? darkTheme : lightTheme,
			syntaxHighlighting(isDark() ? darkHighlightStyle : lightHighlightStyle, { fallback: true }),
		];
		// Typography from the pre-themes.ts editor (kept deliberately): the
		// site's denser 0.85rem size, its mono stack, and roomier content
		// padding. Mounted AFTER the theme compartment so it overrides
		// themes.ts's scroller/content rules.
		const editorTypography = EditorView.theme({
			'&': { fontSize: '0.85rem' },
			'.cm-scroller': {
				overflow: 'auto',
				fontFamily:
					'ui-monospace, SFMono-Regular, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace',
			},
			'.cm-content': { padding: '1rem 0.25rem 1.25rem' },
		});
		// The repl's theme toggle lives in main.ts and only flips the
		// data-theme attribute — observe it rather than threading UI state.
		const outputTheme = new Compartment();
		let sourceEntry: EditorEntry | null = null;
		const applyTheme = () => {
			const ext = themeExtensions();
			if (sourceEntry) sourceView?.dispatch({ effects: sourceEntry.theme.reconfigure(ext) });
			outputView?.dispatch({ effects: outputTheme.reconfigure(ext) });
		};
		themeObserverRef = new MutationObserver(() => {
			window.clearTimeout(themeDebounceRef);
			themeDebounceRef = window.setTimeout(() => {
				if (!disposed) applyTheme();
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
		// diagnostics. Everything below no-ops if the session failed to spawn —
		// the playground stays fully usable without it.
		const uriFor = (name: string): string => `file:///playground/${name}`;
		let tsSession: TypescriptSession | null = null;
		try {
			tsSession = createTypescriptSession();
			tsSessionInstance = tsSession;
		} catch {
			tsSession = null;
		}
		// Re-run pending lints when types/config change underneath — the lint
		// inputs changed without any document edit.
		const relint = StateEffect.define<null>();
		const forceRelint = () => {
			if (!tsSession) return;
			for (const target of [sourceView, outputView]) {
				target?.dispatch({ effects: relint.of(null) });
			}
		};
		const lintExtension: Extension[] = tsSession
			? [
				linter(
					(view) => {
						if (!tsSession || isTsconfigFile(currentFile)) return [];
						return tsSession.getDiagnostics(uriFor(currentFile), view);
					},
					{
						delay: 400,
						needsRefresh: (update: ViewUpdate) =>
							update.transactions.some((tr: Transaction) =>
								tr.effects.some((e) => e.is(relint)),
							),
					},
				),
				lintGutter(),
			]
			: [];
		// didOpen/didChange bookkeeping — mirrors solid-repl's tab sync. The
		// worker dedupes identical texts, so liberal syncing is cheap.
		const registeredTsSources = new Map<string, string>();
		const syncTsFiles = () => {
			if (!tsSession || disposed) return;
			const liveNames = new Set(workspace.files.map((file) => file.name));
			for (const name of [...registeredTsSources.keys()]) {
				if (!liveNames.has(name)) {
					tsSession.worker.postMessage({
						method: 'textDocument/didClose',
						params: { textDocument: { uri: uriFor(name) } },
					});
					registeredTsSources.delete(name);
				}
			}
			for (const file of workspace.files) {
				if (isTsconfigFile(file.name)) continue;
				if (registeredTsSources.get(file.name) === file.source) continue;
				const isOpen = registeredTsSources.has(file.name);
				registeredTsSources.set(file.name, file.source);
				tsSession.worker.postMessage(
					isOpen
						? {
							method: 'textDocument/didChange',
							params: {
								textDocument: { uri: uriFor(file.name), version: 0 },
								contentChanges: [{ text: file.source }],
							},
						}
						: {
							method: 'textDocument/didOpen',
							params: {
								textDocument: { uri: uriFor(file.name), languageId: 'typescript', version: 0, text: file.source },
							},
						},
				);
			}
		};
		// Type acquisition input: the externals map from the last successful
		// graph build, synced only when it actually changes.
		let lastExternals = '';
		const syncTypesFor = (graph: { externals?: Record<string, string> } | null) => {
			if (!tsSession || !graph?.externals) return;
			const fingerprint = JSON.stringify(graph.externals);
			if (fingerprint === lastExternals) return;
			lastExternals = fingerprint;
			void tsSession.syncTypes(graph.externals).then((changed: boolean) => {
				if (changed && !disposed) forceRelint();
			}).catch(() => { });
		};
		// The visitor-editable tsconfig drives the service's compiler options.
		let lastTsconfig = '';
		let tsconfigSyncTimer = 0;
		const scheduleTsconfigSync = () => {
			if (!tsSession) return;
			window.clearTimeout(tsconfigSyncTimer);
			tsconfigSyncTimer = window.setTimeout(() => {
				if (disposed || !tsSession) return;
				const config = parsePlaygroundTsconfig(workspace.files);
				const fingerprint = JSON.stringify(config);
				if (fingerprint === lastTsconfig) return;
				lastTsconfig = fingerprint;
				void tsSession.syncTsconfig(config).then(() => {
					if (!disposed) forceRelint();
				}).catch(() => { });
			}, 300);
		};

		const replaceDoc = (view: EditorView, doc: string) => {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
		};

		// One compile per (file, target) feeds the compiled pane. The preview's
		// module graph compiles through the same Compiler (see kernel/), so the
		// pane shows the exact artifacts the preview runs — no second compile,
		// and cross-file reactivity is visible in the emitted code.
		type CodeEntry = {
			source: string;
			code: string;
			/** The compiled output's AST for the AST pane. */
			ast: unknown;
			/** The compile's source map (output → authored) for code mappings. */
			map: { mappings: string | unknown[][] } | null;
			/** Lazy per-target mapping (see buildMapping). */
			mapping?: CodeMapping | null;
			error: string | null;
		};
		const runtimeCache = new Map<string, CodeEntry>();
		// Track the last graph-level error so pane-only updates don't wipe it
		// when per-file compilation succeeds.
		let lastGraphError = '';

		const runtimeEntry = (name: string): CodeEntry => {
			const source = fileSource(name);
			const cached = runtimeCache.get(name);
			if (cached && cached.source === source) return cached;
			let entry: CodeEntry;
			if (isTsconfigFile(name)) {
				// A config file has no compile step — its "compiled output"
				// is the file itself.
				entry = { source, code: source, ast: null, map: null, error: null };
			} else {
				const output = compiler.outputFor(name);
				const error = compiler.errorFor(name);
				entry = output
					? {
						source,
						code: output.code,
						ast: output.ast,
						map: output.map,
						error: null,
					}
					: {
						source,
						code: '// Compilation failed:\n// ' + (error ?? 'unknown error'),
						ast: null,
						map: null,
						error,
					};
			}
			runtimeCache.set(name, entry);
			return entry;
		};

		const OUTPUT_PLACEHOLDER = '// Compiled output appears here.';

		// Server/Types have no emit yet — the code pane shows a status line
		// and there is nothing to inspect. The AST pane gets an empty tree.
		const placeholderEntry = (code: string): CodeEntry => ({
			source: '',
			code,
			ast: null,
			map: null,
			error: null,
		});

		// ── Source ↔ output position mapping ─────────────────────────────
		// Mark machinery lives in editor/mapping-marks.ts (pure CodeMirror);
		// below: which mapping/AST artifact the compiled pane currently shows.

		// The exact string the output editor currently displays. The output
		// view is read-only and written ONLY here, so this makes both the
		// refresh no-op check and activeMapping's staleness check a string
		// reference compare instead of an O(doc) toString per call.
		let lastShownOutput = OUTPUT_PLACEHOLDER;
		// The entry + target that produced the current document — the
		// mapping owner for whatever the output editor displays, so per-cursor
		// lookups never re-derive which pipeline/target the pane is on.
		let lastShownEntry: { entry: CodeEntry; target: PlaygroundOutputTarget } | null = null;
		// The AST currently shown, with the source it was built from.
		let lastShownAst: { ast: unknown; source: string } | null = null;

		// Built once per (entry, target) and cached on the entry, so a
		// mousemove stream costs one property read.
		const buildMapping = (entry: CodeEntry, target: PlaygroundOutputTarget) => {
			if (target !== 'client' || !entry.map) return null;
			return mappingFromSourceMap(entry.source, entry.code, entry.map);
		};
		const activeMapping = () => {
			if (mode.view !== 'compiled' || mode.mode !== 'code') return null;
			const shown = lastShownEntry;
			if (
				!shown || shown.entry.source !== fileSource(currentFile) ||
				shown.entry.code !== lastShownOutput
			) return null;
			const mapping = buildMapping(shown.entry, shown.target);
			if (mapping) shown.entry.mapping = mapping;
			return mapping;
		};
		// Per-cursor lookups only consult the visible cached artifact. The AST
		// retains authored source offsets, so `source` is the staleness test.
		const activeAstEntry = (): { ast: unknown } | null => {
			if (mode.view !== 'compiled' || mode.mode !== 'ast') return null;
			return lastShownAst?.source === fileSource(currentFile) ? lastShownAst : null;
		};

		const mappedPair = (side: 'source' | 'output', offset: number) => {
			const mapping = activeMapping();
			if (!mapping) return null;
			return side === 'source'
				? mapping.pairFromSource(offset)
				: mapping.pairFromGenerated(offset);
		};
		const clearMappedPair = () => {
			clearMappedIn(sourceView);
			clearMappedIn(outputView);
		};
		const revealPair = (
			pair: { source: { from: number; to: number }[]; output: { from: number; to: number }[] },
			scrollSide: 'source' | 'output' | null,
		) => {
			// Only a deliberate move — a click or a cursor placement — takes the
			// other pane somewhere. Hover marks in place and never steals scroll,
			// so a mapped range far from the hovered line is marked but stays
			// where it is until you click.
			revealRanges(sourceView, pair.source, scrollSide === 'source');
			revealRanges(outputView, pair.output, scrollSide === 'output');
		};
		const revealAstRange = (range: { from: number; to: number } | null, scroll: boolean) => {
			if (mode.mode !== 'ast') return;
			if (!range || !activeAstEntry()) {
				clearMappedPair();
				return;
			}
			clearMappedIn(outputView);
			revealRanges(sourceView, [range], scroll);
		};

		astPreview = createAstPreview(hosts.ast, {
			onNodeRange: revealAstRange,
		});

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
				if (activeAstEntry()) astPreview.reveal(offset, true);
				return;
			}
			const pair = mappedPair(side, offset);
			// Marks reflect the CURRENT selection — an unmapped one clears.
			if (pair) revealPair(pair, side === 'source' ? 'output' : 'source');
			else clearMappedPair();
		});

		// Hovering either document highlights the corresponding ranges without moving its scroll
		// position; clicking/cursor movement above additionally reveals them.
		const crossHover = (side: 'source' | 'output') => EditorView.domEventObservers({
			mousemove(event: MouseEvent, view: EditorView) {
				if (mode.view !== 'compiled') return;
				const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
				if (mode.mode === 'ast') {
					if (offset == null || !activeAstEntry()) clearMappedPair();
					else astPreview.reveal(offset, false);
					return;
				}
				const pair =
					offset == null ? null : mappedPair(side, offset);
				if (pair) revealPair(pair, null);
				else clearMappedPair();
			},
			mouseleave() {
				// The browser can deliver mouseleave before the mobile pane's
				// display:none reaches layout. The synchronous pane ref makes
				// that stale event harmless from the instant Inspect is clicked.
				if (side === 'source' && ui.isResultPaneVisible()) return;
				clearMappedPair();
				astPreview.clear();
			},
		});

		const astEntry = (): { ast: unknown; source: string; label: string; notice: string; error: string | null } | null => {
			const target = mode.target;
			if (target === 'server' || target === 'types') return null;
			const meta = AST_TARGET_META[target];
			const entry = runtimeEntry(currentFile);
			if (entry.error) return { ast: null, source: entry.source, label: meta.label, notice: meta.notice, error: entry.error };
			return {
				ast: entry.ast,
				source: entry.source,
				label: meta.label,
				notice: meta.notice,
				error: null,
			};
		};

		// The output document per target; server/types are placeholders with
		// no mapping at all.
		const targetEntry = (target: PlaygroundOutputTarget): CodeEntry => {
			switch (target) {
				case 'server':
					return placeholderEntry(SERVER_OUTPUT_NOTE);
				case 'types':
					return placeholderEntry(TYPES_OUTPUT_NOTE);
				default:
					return runtimeEntry(currentFile);
			}
		};

		const showOutput = (): string | null => {
			// The compiled pane is not visible: skip entirely — no types
			// generation and no doc replacement. syncOutput re-runs this when
			// the pane is revealed, so it refreshes exactly once, on demand.
			if (mode.view !== 'compiled') return null;
			if (mode.mode === 'ast') {
				const target = mode.target;
				const meta = AST_TARGET_META[target];
				const entry = astEntry();
				if (!entry) {
					// Server/Types have no emit yet — nothing to inspect.
					clearMappedPair();
					astPreview.setUnavailable(meta.notice, currentFile);
					lastShownAst = null;
					return null;
				}
				if (entry.ast) {
					if (entry.ast !== lastShownAst?.ast) {
						clearMappedPair();
						astPreview.setAst(entry.ast, currentFile, {
							label: entry.label,
							notice: entry.notice,
						});
						lastShownAst = { ast: entry.ast, source: entry.source };
					}
				} else {
					clearMappedPair();
					const message =
						'AST generation failed. Fix the source to generate a new tree.';
					astPreview.setUnavailable(message, currentFile);
					lastShownAst = null;
				}
				// Preserve a graph-level error when per-file inspection succeeds.
				patch({ error: entry.error || lastGraphError });
				return entry.error;
			}
			const target = mode.target;
			const output = targetEntry(target);
			const code = output.code;
			// AST and code highlights describe different artifacts, so a switch
			// between them clears the pair even when the cached document
			// needs no replacement.
			//
			// A refresh that lands on the SAME artifact must leave marks alone.
			// This runs from compileAndRun AFTER its awaited buildModuleGraph, so
			// the initial compile completes a few hundred ms after the pane is
			// interactive — long enough for a pointer to be resting on a mapped
			// keyword. Clearing unconditionally wiped that highlight while the
			// pointer never moved, and mousemove is the only thing that restores
			// it, so the mark stayed gone until the reader jiggled the mouse.
			// Identity is the conservative test: entries are cached per (file,
			// target, source), and any miss yields a fresh object that falls back
			// to clearing.
			const sameArtifact = output === lastShownEntry?.entry && code === lastShownOutput;
			if (!sameArtifact) {
				clearMappedPair();
				astPreview.clear();
			}
			// Preserve a graph-level error when switching output artifacts.
			patch({ error: output.error || lastGraphError });
			lastShownEntry = { entry: output, target };
			if (typeof code !== 'string' || code === lastShownOutput) return output.error;
			replaceDoc(outputView, code);
			lastShownOutput = code;
			// The output half of the pair changed — source marks were computed
			// against the previous artifact (the output field self-cleared via
			// its own doc change just now).
			clearMappedIn(sourceView);
			return output.error;
		};

		let compileSeq = 0;
		const compileAndRun = async () => {
			if (disposed) return;
			const seq = ++compileSeq;
			// Keep the TS worker's document set in lockstep with the workspace.
			// Boot and every structural change (example switch, add/remove/
			// rename) flow through here; typing flows through the update
			// listener. Without this, sibling files are never opened in the
			// worker and their imports resolve as missing modules.
			syncTsFiles();
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
				lastGraphError = graph.error;
				patch({ error: graph.error });
				return;
			}
			lastGraphError = '';
			patch({ error: outputError || '' });
			// New externals in the graph → fetch their declaration files and
			// re-lint once the worker's environment is rebuilt.
			syncTypesFor(graph);
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

		// replaceState (not router.navigate) — only the hash on the current
		// entry changes; the router observes it through its history wrapper
		// without remounting the route. While a shared payload is still
		// gated, the URL keeps the sender's link untouched.
		const updateHash = () => {
			window.clearTimeout(hashDebounceId);
			hashDebounceId = window.setTimeout(() => {
				if (executionGated) return;
				const encoded = encodePlaygroundHash({
					lang: 'tsx',
					entry: workspace.entry,
					files: [...workspace.files],
				});
				if (!encoded) return;
				window.history.replaceState(null, '', '#' + encoded);
				try {
					window.sessionStorage.setItem(
						OWN_HASH_STORAGE_KEY,
						JSON.stringify({ hash: encoded, exampleId: currentExampleId }),
					);
				} catch {
					// Storage full/unavailable — sharing still works, only the
					// reload-without-consent nicety is lost.
				}
			}, HASH_DEBOUNCE_MS);
		};

		// One writable EditorView; each file keeps its own EditorState (undo
		// history included), keyed per file. Each entry carries its theme
		// Compartment so a restored state can be re-themed to the CURRENT
		// page theme (it may have been created under the other one).
		interface EditorEntry {
			state: EditorState;
			theme: Compartment;
			json: boolean;
		}
		const editorStates = new Map<string, EditorEntry>();
		const stateKey = (name: string) => name;

		const makeEditorEntry = (name: string, doc: string): EditorEntry => {
			const theme = new Compartment();
			const json = isTsconfigFile(name);
			return {
				theme,
				json,
				state: EditorState.create({
					doc,
					extensions: [
						EditorState.changeFilter.of((transaction: Transaction) => {
							if (!transaction.docChanged) return true;
							const others = workspace.totalLength() - workspace.source(currentFile).length;
							if (others + transaction.newDoc.length <= MAX_PLAYGROUND_SOURCE_LENGTH) {
								return true;
							}
							patch({ error: PLAYGROUND_SOURCE_LIMIT_ERROR });
							return false;
						}),
						lineNumbers(),
						foldGutter(),
						codeFolding(),
						history(),
						drawSelection(),
						highlightActiveLine(),
						keymap.of([
							{
								key: 'Mod-Shift-f',
								run: () => {
									commands.formatActive?.();
									return true;
								},
							},
							...defaultKeymap,
							...historyKeymap,
							indentWithTab,
						]),
						EditorView.lineWrapping,
						EditorState.tabSize.of(2),
						// Solid-repl parity: themes.ts paints ALL tokens through the
						// Lezer highlight style; lsp-client also reads that facet when
						// rendering code fences inside hover/completion tooltips.
						theme.of(themeExtensions()),
						// DarTsx TextMate highlighting (our VS Code extension's injection
						// grammars via Shiki) — paints what the Lezer TSX grammar cannot
						// see (component/state/derived/render/bind, <style> blocks).
						editorTypography,
						shikiHighlight(json ? 'json' : 'tsx'),
						// Language features ride along only on source files — the tsconfig
						// document stays a plain JSON viewer.
						...(json || !tsSession
							? []
							: [
								typescript({ jsx: true }),
								tsSession.client.plugin(uriFor(name), 'typescript'),
								typescriptLspExtras,
								typescriptLspTheme,
							]),
						lintExtension,
						mappedField,
						crossHover('source'),
						crossNavigate('source'),
						EditorView.updateListener.of((update: ViewUpdate) => {
							if (!update.docChanged) return;
							// The source half of the pair changed — orphan any marks still
							// shown in the output (this field self-clears; a failed
							// recompile would otherwise leave the output's marks forever).
							clearMappedIn(outputView);
							if (mode.mode === 'ast') {
								astPreview.setUnavailable('Waiting for the next successful compile…', currentFile);
								lastShownAst = null;
							}
							const next = update.state.doc.toString();
							workspace.update(currentFile, next);
							// Any edit means the buffer no longer matches the example.
							if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
								currentExampleId = CUSTOM_EXAMPLE_ID;
								patch({ exampleId: CUSTOM_EXAMPLE_ID });
							}
							scheduleCompile();
							syncTsFiles();
							if (isTsconfigFile(currentFile)) scheduleTsconfigSync();
							updateHash();
						}),
					],
				}),
			};
		};

		const openFile = (name: string) => {
			editorStates.set(stateKey(currentFile), sourceEntry!);
			currentFile = name;
			const existing = editorStates.get(stateKey(name));
			sourceEntry = existing ?? makeEditorEntry(name, fileSource(name));
			sourceView.setState(sourceEntry.state);
			// setState fires no transaction: re-theme the restored state (it
			// may have been created under the other page theme), and a
			// restored state may carry marks from an old pair — clear them,
			// along with the output's marks which belong to the old file.
			sourceView.dispatch({ effects: sourceEntry.theme.reconfigure(themeExtensions()) });
			clearMappedIn(sourceView);
			clearMappedIn(outputView);
			patch({ activeFile: name });
			showOutput();
		};

		sourceEntry = makeEditorEntry(currentFile, fileSource(currentFile));
		sourceView = new EditorView({
			state: sourceEntry.state,
			parent: hosts.source,
		});

		outputView = new EditorView({
			state: EditorState.create({
				doc: OUTPUT_PLACEHOLDER,
				extensions: [
					lineNumbers(),
					foldGutter(),
					codeFolding(),
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					EditorView.lineWrapping,
					// Solid-repl's output pane runs the same theme pair and the
					// TSX language so compiled output gets Lezer highlighting too.
					outputTheme.of(themeExtensions()),
					editorTypography,
					shikiHighlight('tsx'),
					typescript({ jsx: true }),
					mappedField,
					crossHover('output'),
					crossNavigate('output'),
				],
			}),
			parent: hosts.output,
		});

		commands.selectExample = (id) => {
			if (disposed || id === CUSTOM_EXAMPLE_ID || id === currentExampleId) return;
			const example = pgExamples.getExample(id);
			if (!example) return;
			currentExampleId = id;
			// The visitor's tsconfig survives an example switch — it is
			// workspace state, not example content (Vue-REPL behavior).
			workspace.load(pgExamples.exampleWorkspace(example), { preserveTsconfig: true });
			currentFile = workspace.entry;
			editorStates.clear();
			runtimeCache.clear();
			lastShownEntry = null;
			lastShownAst = null;
			sourceEntry = makeEditorEntry(currentFile, fileSource(currentFile));
			sourceView.setState(sourceEntry.state);
			clearMappedIn(sourceView);
			clearMappedIn(outputView);
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
			editorStates.delete(stateKey(name));
			// The compile cache is keyed by file name — purge the deleted one
			// rather than churn every key. Nothing else references them.
			runtimeCache.delete(name);
			if (wasCurrent) {
				// Fall to the file that took the tab's place, wrapping to the
				// first when the last file was deleted.
				const next = workspace.files[Math.min(index, workspace.files.length - 1)];
				const existing = editorStates.get(stateKey(next.name));
				currentFile = next.name;
				sourceEntry = existing ?? makeEditorEntry(currentFile, fileSource(currentFile));
				sourceView.setState(sourceEntry.state);
				sourceView.dispatch({ effects: sourceEntry.theme.reconfigure(themeExtensions()) });
				// setState fires no transaction: the old file's marks are stale.
				clearMappedIn(sourceView);
			}
			clearMappedIn(outputView);
			lastShownEntry = null;
			lastShownAst = null;
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
			const savedState = editorStates.get(oldName);
			if (savedState) {
				editorStates.delete(oldName);
				editorStates.set(name, savedState);
			}
			// The compile cache is keyed by file name — drop the old key so
			// the next compile repopulates it under the new name.
			runtimeCache.delete(oldName);
			// A rename makes the buffer non-example, like any edit.
			if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
				currentExampleId = CUSTOM_EXAMPLE_ID;
				patch({ exampleId: CUSTOM_EXAMPLE_ID });
			}
			clearMappedIn(sourceView);
			clearMappedIn(outputView);
			lastShownEntry = null;
			lastShownAst = null;
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
					const source = sourceView.state.doc.toString();
					const result = await formatPlaygroundFile(currentFile, source);
					if (disposed) return;
					if (!result.ok) {
						patch({ error: result.error });
						return;
					}
					if (result.code !== source) replaceDoc(sourceView, result.code);
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
			clearMappedIn(sourceView);
			clearMappedIn(outputView);
		};
		commands.ensureDevtools = () => {
			if (disposed) return;
			preview.ensureDevtools();
		};
		commands.getTsConfig = () => parsePlaygroundTsconfig(workspace.files);
		commands.revealAst = () => {
			if (disposed || !activeAstEntry()) return;
			astPreview.reveal(sourceView.state.selection.main.head, true);
		};

		publishWorkspaceState();
		// Seed the TypeScript worker with the workspace + its compiler
		// options; the first compileAndRun below also feeds it externals.
		scheduleTsconfigSync();
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
			tsSessionInstance?.dispose();
			sourceView?.destroy();
			outputView?.destroy();
			astPreview?.destroy();
			preview?.destroy();
		},
	};
}
