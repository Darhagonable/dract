// The playground engine: owns every piece of interactive state and the
// imperative editor stack (CodeMirror, the compile pipeline, the sandboxed
// preview, and the source↔output mapping). All of it boots once, in an
// effect. The components read state from this hook and drive the engine
// through the `controller` (see PlaygroundController).
//
// The whole pipeline runs in the browser: the `dartsx` compiler (oxc-parser/
// oxc-transform WASM bindings + esrap — no Node APIs) compiles the virtual
// files on a debounce, the module graph executes inside a SANDBOXED IFRAME
// with an opaque origin (see src/utils/playground.ts + playground-modules.ts +
// playground-sandbox.ts — never in this page), and CodeMirror is themed and
// syntax-highlighted exactly like solid-repl: themes.ts paints the chrome AND
// every token through its Lezer highlight styles (dark/lightHighlightStyle).
// The TypeScript language layer lives in its own worker chunk (see
// typescript-session.ts) — only its small client half is bundled here.
//
// Shared links are UNTRUSTED input: a hash payload is decoded into the editor
// and compiled (source + compiled output are safe to display — compilation is
// pure string work), but it does NOT execute — even in the sandbox — until the
// visitor explicitly presses "Run" on the consent overlay. Your own edits from
// the default sources auto-run as before.
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
	Compartment,
	EditorState,
	StateEffect,
	StateField,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
	Decoration,
	drawSelection,
	EditorView,
	highlightActiveLine,
	keymap,
	lineNumbers,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import { linter, lintGutter } from '@codemirror/lint';
import { darkHighlightStyle, darkTheme, lightHighlightStyle, lightTheme } from './themes.ts';
import { codeFolding, foldGutter, syntaxHighlighting } from '@codemirror/language';
import { shikiHighlight } from './shiki-codemirror.ts';
import { createPreview, type PlaygroundOutputTarget, type Preview } from './playground.ts';
import { mappingFromSourceMap, type CodeMapping } from './playground-mapping.ts';
import {
	decodePlaygroundHash,
	encodePlaygroundHash,
	MAX_PLAYGROUND_FILES,
	MAX_PLAYGROUND_SOURCE_LENGTH,
	PLAYGROUND_SOURCE_LIMIT_ERROR,
} from './playground-hash.ts';
import {
	buildModuleGraph,
	compileError,
	getModuleOutput,
	TSCONFIG_FILE_NAME,
	isTsconfigFile,
	parsePlaygroundTsconfig,
	type ModuleGraph,
	type ModuleGraphFailure,
	type PlaygroundFile,
} from './playground-modules.ts';
import { createAstPreview, type AstPreviewController } from './playground-ast.ts';
import { createTypescriptSession, type TypescriptSession } from './typescript-session.ts';
import { typescript, typescriptLspExtras, typescriptLspTheme } from './typescript-lsp.ts';
import * as pgExamples from './playground-examples.ts';

const { EXAMPLES, CUSTOM_EXAMPLE_ID, DEFAULT_EXAMPLE_ID } = pgExamples;

const HASH_DEBOUNCE_MS = 400;
// A generated name immediately preceded by one of these is its declaration
// rather than a reference to it — the preferred target when navigating.
const DECLARATION_BEFORE = /\b(?:function|const|let|var|class)\s+$/;
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

// Static dropdown structure — examples grouped into <optgroup>s in
// declaration order.
const EXAMPLE_GROUPS: { group: string; examples: typeof EXAMPLES }[] = [];
for (const example of EXAMPLES) {
	const bucket = EXAMPLE_GROUPS.find((candidate) => candidate.group === example.group);
	if (bucket) bucket.examples.push(example);
	else EXAMPLE_GROUPS.push({ group: example.group, examples: [example] });
}

// Imperative bridge into the boot closure — the toolbar buttons (and the
// consent overlay's Run button) call through it. Populated once the editor
// stack has loaded.
export interface PlaygroundController {
	selectExample?: (id: string) => void;
	selectFile?: (name: string) => void;
	addFile?: () => void;
	removeFile?: (name: string) => void;
	renameFile?: (oldName: string, nextName: string) => void;
	moveFile?: (fromName: string, toName: string) => void;
	formatActive?: () => void;
	approveRun?: () => void;
	syncOutput?: () => void;
	revealAst?: () => void;
	ensureDevtools?: () => void;
	/**
	 * The workspace's parsed tsconfig.json (Vue-REPL `getTsConfig` contract):
	 * the raw parsed JSON, or null when missing or malformed. Nothing consumes
	 * it yet — it is the agreed surface for compiler options once a
	 * type-checking or emit layer lands.
	 */
	getTsConfig?: () => Record<string, unknown> | null;
}

export interface PlaygroundEngine {
	view: 'preview' | 'compiled';
	pane: 'editor' | 'result';
	paneRef: RefObject<'editor' | 'result'>;
	error: string;
	ready: boolean;
	formatting: boolean;
	gated: boolean;
	exampleId: string;
	files: string[];
	activeFile: string;
	inputValue: string;
	renameInputRef: RefObject<HTMLInputElement | null>;
	dragOverFile: string | null;
	draggingFileRef: MutableRefObject<string | null>;
	focusInputSignal: number;
	entryFile: string;
	compiledMode: 'code' | 'ast';
	outputTarget: PlaygroundOutputTarget;
	sourceHostRef: RefObject<HTMLDivElement | null>;
	outputHostRef: RefObject<HTMLDivElement | null>;
	astHostRef: RefObject<HTMLDivElement | null>;
	previewHostRef: RefObject<HTMLDivElement | null>;
	devtoolsHostRef: RefObject<HTMLDivElement | null>;
	/** Whether the devtools bottom panel (hosting the chii frontend) is open. */
	devtoolsOpen: boolean;
	controller: PlaygroundController;
	selectView: (next: 'preview' | 'compiled') => void;
	openMobilePreview: () => void;
	openMobileCompiled: () => void;
	selectCompiledMode: (mode: 'code' | 'ast') => void;
	selectOutputTarget: (target: PlaygroundOutputTarget) => void;
	setPane: (pane: 'editor' | 'result') => void;
	setInputValue: (value: string) => void;
	setDragOverFile: (file: string | null) => void;
	toggleDevtools: () => void;
}

export function usePlayground(): PlaygroundEngine {
	const [view, setView] = useState<'preview' | 'compiled'>('preview');
	// Mobile only: which panel is visible (desktop always shows both).
	const [pane, setPane] = useState<'editor' | 'result'>('editor');
	const paneRef = useRef<'editor' | 'result'>('editor');
	const [error, setError] = useState('');
	const [ready, setReady] = useState(false);
	const [formatting, setFormatting] = useState(false);
	// True while a hash-shared payload is loaded but not yet approved to run.
	const [gated, setGated] = useState(false);
	const [exampleId, setExampleId] = useState<string>(DEFAULT_EXAMPLE_ID);
	const [files, setFiles] = useState<string[]>([]);
	const [activeFile, setActiveFile] = useState('');
	// Svelte-REPL-style tabs: the ACTIVE tab's name is a live inline input —
	// this state is its value (kept in sync with the active file's name).
	const [inputValue, setInputValue] = useState('');
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	// The file hovered while a drag reorder is in flight (highlights the tab
	// the dragged file will land on); the dragged file itself lives in a ref.
	const [dragOverFile, setDragOverFile] = useState<string | null>(null);
	const draggingFileRef = useRef<string | null>(null);
	// A fresh tab focuses its name input; bumped by addFile. Plain tab
	// switches never focus it.
	const [focusInputSignal, setFocusInputSignal] = useState(0);
	// Which file the preview imports and renders — marked on its tab.
	const [entryFile, setEntryFile] = useState('');
	// The compiled pane's mode: code view or AST view.
	const [compiledMode, setCompiledMode] = useState<'code' | 'ast'>('code');
	// The compiled pane's artifact target. Server and Types are placeholders.
	const [outputTarget, setOutputTarget] = useState<PlaygroundOutputTarget>('client');

	const sourceHostRef = useRef<HTMLDivElement | null>(null);
	const outputHostRef = useRef<HTMLDivElement | null>(null);
	const astHostRef = useRef<HTMLDivElement | null>(null);
	const previewHostRef = useRef<HTMLDivElement | null>(null);
	const devtoolsHostRef = useRef<HTMLDivElement | null>(null);
	// Whether the devtools panel under the preview is open. The frontend iframe
	// itself is created lazily on the first open (multi-MB CDN payload).
	const [devtoolsOpen, setDevtoolsOpen] = useState(false);
	// The boot closure runs once, so it can't read the view STATE — this ref
	// mirrors it (updated by the same handlers that set state) for the
	// closure's output-refresh path.
	const resultModeRef = useRef<{ view: 'preview' | 'compiled'; mode: 'code' | 'ast'; target: PlaygroundOutputTarget }>({
		view: 'preview',
		mode: 'code',
		target: 'client',
	});
	const controllerRef = useRef<PlaygroundController>({});

	const selectView = (next: 'preview' | 'compiled') => {
		setView(next);
		resultModeRef.current.view = next;
		controllerRef.current.syncOutput?.();
	};
	const openMobilePreview = () => {
		selectView('preview');
		paneRef.current = 'result';
		setPane('result');
	};
	// Mobile's third pane is the compiled view, showing the client emit of
	// the active file.
	const openMobileCompiled = () => {
		setView('compiled');
		paneRef.current = 'result';
		setPane('result');
		resultModeRef.current.view = 'compiled';
		controllerRef.current.syncOutput?.();
	};
	const selectCompiledMode = (mode: 'code' | 'ast') => {
		setCompiledMode(mode);
		resultModeRef.current.mode = mode;
		controllerRef.current.syncOutput?.();
	};
	// Switching targets re-renders the compiled pane with the new artifact.
	const selectOutputTarget = (target: PlaygroundOutputTarget) => {
		setOutputTarget(target);
		resultModeRef.current.target = target;
		controllerRef.current.syncOutput?.();
	};
	// Opening the panel lazily creates the devtools frontend iframe (the boot
	// handshake with the sandbox's chobitsu is handled inside createPreview).
	const toggleDevtools = () => {
		setDevtoolsOpen((open) => {
			if (!open) controllerRef.current.ensureDevtools?.();
			return !open;
		});
	};
	// Reveal only after the mobile result panel has committed as visible;
	// scrollIntoView cannot position a node while its panel is display:none.
	useEffect(() => {
		if (ready && pane === 'result' && view === 'compiled' && compiledMode === 'ast') {
			controllerRef.current.revealAst?.();
		}
	}, [ready, pane, view, compiledMode, outputTarget]);

	// Focus the active tab's name input after addFile bumped the signal.
	useEffect(() => {
		if (focusInputSignal > 0) renameInputRef.current?.focus();
	}, [focusInputSignal]);
	// Keep the live tab-name input in sync with the active file (tab
	// switches, example loads, deletions) — edits themselves flow the other
	// way, through the input's own handlers.
	useEffect(() => {
		setInputValue(activeFile);
	}, [activeFile]);

	useEffect(() => {
		const sourceHost = sourceHostRef.current;
		const outputHost = outputHostRef.current;
		const astHost = astHostRef.current;
		const previewHost = previewHostRef.current;
		if (!sourceHost || !outputHost || !astHost || !previewHost) return;

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
		// Validate the URL payload before booting the editor stack or the
		// compiler. Oversized input is ignored in favor of the bounded defaults.
		const rawHash = window.location.hash.slice(1);
		const hashResult = decodePlaygroundHash(rawHash);
		const initial = hashResult.ok ? hashResult.value : null;
		const initialDiagnostic = hashResult.ok ? '' : hashResult.error;
		if (initialDiagnostic) setError(initialDiagnostic);

		(async () => {
			if (disposed) return;

			type Workspace = { files: PlaygroundFile[]; entry: string };

			const cloneWorkspace = (workspace: Workspace): Workspace => ({
				entry: workspace.entry,
				files: workspace.files.map((file) => ({ ...file })),
			});

			let currentExampleId: string = initial ? CUSTOM_EXAMPLE_ID : DEFAULT_EXAMPLE_ID;
			let workspace: Workspace = cloneWorkspace(pgExamples.DEFAULT_WORKSPACE);
			// Vue-REPL-style tsconfig: a workspace always carries its config file,
			// even when a hash payload (or the defaults) did not include one.
			const ensureTsconfig = () => {
				if (workspace.files.some((file: PlaygroundFile) => file.name === TSCONFIG_FILE_NAME)) return;
				workspace.files.push({ name: TSCONFIG_FILE_NAME, source: pgExamples.DEFAULT_TSCONFIG_SOURCE });
			};
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
				workspace = { entry: initial.entry, files: initial.files };
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
					setGated(true);
				}
			}
			ensureTsconfig();
			let currentFile = workspace.entry;

			const fileSource = (name: string): string =>
				workspace.files.find((file) => file.name === name)?.source ?? '';

			const publishWorkspaceState = () => {
				setExampleId(currentExampleId);
				setFiles(workspace.files.map((file) => file.name));
				setActiveFile(currentFile);
				setEntryFile(workspace.entry);
			};

			// ── Editor theming, exactly solid-repl's architecture ────────────
			// themes.ts owns everything: per-theme editor chrome (darkTheme /
			// lightTheme) plus the Lezer highlight styles (dark/lightHighlightStyle)
			// that paint ALL editor tokens — there is no Shiki here. The active
			// pair is mounted through Compartments and reconfigured when the
			// page's data-theme flips (see the MutationObserver below).
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
			// data-theme attribute — observe it rather than threading React state.
			// (The observer/debounce live on effect-level refs so unmount can
			// reach them.)
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

			preview = createPreview(previewHost, (message: string) => {
				if (!disposed) setError(message);
			}, devtoolsHostRef.current);

			// ── TypeScript intellisense (LSP over a worker) ─────────────────
			// One session for every file's EditorState: the worker runs the TS
			// language service against preprocessed DarTsx (see ts-worker.ts),
			// lsp-client renders hover/completions/signature/jump-to-def, and the
			// linter paints diagnostics. Everything below no-ops if the session
			// failed to spawn — the playground stays fully usable without it.
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
				const liveNames = new Set(workspace.files.map((file: PlaygroundFile) => file.name));
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
			// module graph compiles through the same Project (see
			// playground-modules.ts), so the pane shows the exact artifacts the
			// preview runs — no second compile, and cross-file reactivity is
			// visible in the emitted code.
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
					const output = getModuleOutput(name);
					const error = compileError(name);
					entry = output
						? {
							source,
							code: output.js.code,
							ast: output.ast,
							map: output.js.map,
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
			// Placing the cursor in one editor highlights and reveals the mapped
			// ranges in the other (see playground-mapping.ts for the semantics).
			// Marks are only valid for the exact (source doc, output doc) PAIR
			// they were computed against, so a change to either side must clear
			// BOTH editors: each field self-clears on its own doc change, and
			// clearMappedIn handles the cross-editor half (a source edit leaves
			// output marks orphaned — visibly so when a broken edit means no
			// recompile ever replaces the output doc — and setState doc swaps
			// produce no transaction at all).
			const setMapped = StateEffect.define<DecorationSet>();
			const mappedMark = Decoration.mark({ class: 'cm-mapped' });
			const mappedField = StateField.define<DecorationSet>({
				create: () => Decoration.none,
				update(value, tr: Transaction) {
					for (const effect of tr.effects) if (effect.is(setMapped)) return effect.value;
					// Any edit (or an output refresh) invalidates the offsets.
					return tr.docChanged ? Decoration.none : value;
				},
				provide: (field) => EditorView.decorations.from(field),
			});
			// Per-keystroke safe: one O(1) field-size read, and a transaction is
			// dispatched only when marks actually exist to clear.
			const clearMappedIn = (targetView: EditorView) => {
				if (targetView.state.field(mappedField, false)?.size) {
					targetView.dispatch({ effects: setMapped.of(Decoration.none) });
				}
			};
			// Does the view already show exactly `ranges` (sorted, as the mapping
			// and AST paths produce them)?
			const sameMarks = (targetView: EditorView, ranges: { from: number; to: number }[]) => {
				const current = targetView.state.field(mappedField, false);
				if (!current || current.size !== ranges.length) return false;
				let index = 0;
				let same = true;
				current.between(0, targetView.state.doc.length, (from: number, to: number) => {
					const range = ranges[index++];
					if (!range || range.from !== from || range.to !== to) {
						same = false;
						return false;
					}
				});
				return same && index === ranges.length;
			};

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
				if (
					resultModeRef.current.view !== 'compiled' || resultModeRef.current.mode !== 'code'
				) return null;
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
				if (
					resultModeRef.current.view !== 'compiled' || resultModeRef.current.mode !== 'ast'
				) return null;
				return lastShownAst?.source === fileSource(currentFile) ? lastShownAst : null;
			};

			const revealRanges = (
				targetView: EditorView,
				ranges: { from: number; to: number }[],
				scroll: boolean,
			) => {
				const limit = targetView.state.doc.length;
				const clamped = ranges.map(
					(range) => ({
						from: range.from,
						to: Math.min(range.to, limit),
					}),
				).filter((range) => range.from >= 0 && range.from < range.to);
				if (clamped.length === 0) {
					// Same contract as an unmapped position: no lingering marks.
					clearMappedIn(targetView);
					return;
				}
				// A pointer stream re-resolves the SAME ranges for most of its
				// samples. The field is the single source of truth (it self-clears
				// on any doc change), so comparing against it is always safe and
				// costs one pass over the handful of ranges shown.
				if (!scroll && sameMarks(targetView, clamped)) return;
				const marks = setMapped.of(
					Decoration.set(
						clamped.map((range) => mappedMark.range(range.from, range.to)),
					),
				);
				// Jump to the DEFINITION when one of the mapped ranges is a declared
				// name: a directive arm maps both to `function __case$0(…)` and to
				// where that name is handed to the runtime, and the implementation is
				// what you want to read. Every range still gets a mark either way.
				if (scroll) {
					const declared =
						clamped.find((range) => DECLARATION_BEFORE.test(
							targetView.state.doc.sliceString(Math.max(0, range.from - 12), range.from),
						)) ?? clamped[0];
					const scrollEffect = EditorView.scrollIntoView(declared.from, { y: 'center' });
					targetView.dispatch({ effects: [marks, scrollEffect] });
				} else {
					targetView.dispatch({ effects: marks });
				}
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
				if (resultModeRef.current.mode !== 'ast') return;
				if (!range || !activeAstEntry()) {
					clearMappedPair();
					return;
				}
				clearMappedIn(outputView);
				revealRanges(sourceView, [range], scroll);
			};

			astPreview = createAstPreview(astHost, {
				onNodeRange: revealAstRange,
			});

			const crossNavigate = (side: 'source' | 'output') => EditorView.updateListener.of((
				update: ViewUpdate,
			) => {
				if (!update.selectionSet || update.docChanged) return;
				// Only user-driven cursor moves navigate — programmatic dispatches
				// (doc replacement, highlight effects) must not feed back.
				if (!update.transactions.some((tr) => tr.isUserEvent('select'))) return;
				if (resultModeRef.current.view !== 'compiled') return;
				const offset = update.state.selection.main.head;
				if (resultModeRef.current.mode === 'ast') {
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
					if (resultModeRef.current.view !== 'compiled') return;
					const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
					if (resultModeRef.current.mode === 'ast') {
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
					if (
						side === 'source' && paneRef.current === 'result' &&
						window.matchMedia('(max-width: 980px)').matches
					) return;
					clearMappedPair();
					astPreview.clear();
				},
			});

			const astEntry = (): { ast: unknown; source: string; label: string; notice: string; error: string | null } | null => {
				const target = resultModeRef.current.target;
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
				if (resultModeRef.current.view !== 'compiled') return null;
				if (resultModeRef.current.mode === 'ast') {
					const target = resultModeRef.current.target;
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
					setError(entry.error || lastGraphError);
					return entry.error;
				}
				const target = resultModeRef.current.target;
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
				setError(output.error || lastGraphError);
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
				const { files: wsFiles, entry } = workspace;
				const total = wsFiles.reduce(
					(sum: number, file: { source: string }) => sum + file.source.length,
					0,
				);
				if (total > MAX_PLAYGROUND_SOURCE_LENGTH) {
					setError(PLAYGROUND_SOURCE_LIMIT_ERROR);
					return;
				}
				const graph = await buildModuleGraph(wsFiles, entry);
				if (disposed || seq !== compileSeq) return;
				// The compiled pane describes the active source file, independently
				// of whether another workspace file prevents the runnable module
				// graph from compiling. Refresh it before handling graph failure.
				const outputError = showOutput();
				if (!graph.ok) {
					lastGraphError = graph.error;
					setError(graph.error);
					return;
				}
				lastGraphError = '';
				setError(outputError || '');
				// New externals in the graph → fetch their declaration files and
				// re-lint once the worker's environment is rebuilt.
				syncTypesFor(graph);
				// While a shared payload is gated, everything except EXECUTION
				// happens — the visitor can inspect source and compiled output.
				if (executionGated) return;
				void preview.run(graph).then((r: { error: string | null }) => {
					if (!disposed && r.error) setError(r.error);
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
					const { files: wsFiles, entry } = workspace;
					const encoded = encodePlaygroundHash({
						lang: 'tsx',
						entry,
						files: wsFiles,
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
								const others = workspace.files.reduce(
									(sum, file) => file.name === currentFile
										? sum
										: sum + file.source.length,
									0,
								);
								if (others + transaction.newDoc.length <= MAX_PLAYGROUND_SOURCE_LENGTH) {
									return true;
								}
								setError(PLAYGROUND_SOURCE_LIMIT_ERROR);
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
										controllerRef.current.formatActive?.();
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
								if (resultModeRef.current.mode === 'ast') {
									astPreview.setUnavailable('Waiting for the next successful compile…', currentFile);
									lastShownAst = null;
								}
								const next = update.state.doc.toString();
								const file = workspace.files.find(
									(candidate) => candidate.name === currentFile,
								);
								if (file) file.source = next;
								// Any edit means the buffer no longer matches the example.
								if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
									currentExampleId = CUSTOM_EXAMPLE_ID;
									setExampleId(CUSTOM_EXAMPLE_ID);
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
				setActiveFile(name);
				showOutput();
			};

			sourceEntry = makeEditorEntry(currentFile, fileSource(currentFile));
			sourceView = new EditorView({
				state: sourceEntry.state,
				parent: sourceHost,
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
				parent: outputHost,
			});

			controllerRef.current.selectExample = (id) => {
				if (disposed || id === CUSTOM_EXAMPLE_ID || id === currentExampleId) return;
				const example = pgExamples.getExample(id);
				if (!example) return;
				currentExampleId = id;
				// The visitor's tsconfig survives an example switch — it is
				// workspace state, not example content (Vue-REPL behavior).
				const tsconfig = workspace.files.find(
					(file: PlaygroundFile) => file.name === TSCONFIG_FILE_NAME,
				);
				workspace = pgExamples.exampleWorkspace(example);
				if (tsconfig && !workspace.files.some((file: PlaygroundFile) => file.name === TSCONFIG_FILE_NAME)) {
					workspace.files.push({ name: tsconfig.name, source: tsconfig.source });
				}
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
				setGated(false);
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void compileAndRun();
				updateHash();
			};

			controllerRef.current.selectFile = (name) => {
				if (disposed || name === currentFile) return;
				if (!workspace.files.some((file) => file.name === name)) return;
				openFile(name);
			};

			// Svelte-REPL-style file management. A new file is a plain comment —
			// valid for any file kind, so it compiles into a runnable graph while
			// the visitor decides what it becomes.
			const NEW_FILE_SOURCE = '// New file — replace this with your code.';
			const nextFileName = () => {
				const names = new Set(workspace.files.map((file) => file.name));
				let index = 1;
				let name = 'File.tsx';
				while (names.has(name)) name = `File-${++index}.tsx`;
				return name;
			};

			controllerRef.current.addFile = () => {
				if (disposed || workspace.files.length >= MAX_PLAYGROUND_FILES) return;
				const name = nextFileName();
				workspace.files.push({ name, source: NEW_FILE_SOURCE });
				// Any structural change means the buffer no longer matches the
				// example (the same flip edits perform).
				if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
					currentExampleId = CUSTOM_EXAMPLE_ID;
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				openFile(name);
				// The new tab's name input is live (Svelte-REPL-style) — focus
				// it so the visitor can name the file right away.
				setInputValue(name);
				setFocusInputSignal((n) => n + 1);
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void compileAndRun();
				updateHash();
			};

			controllerRef.current.removeFile = (name) => {
				if (disposed || workspace.files.length <= 1) return;
				// The entry is the workspace root and the tsconfig is injected
				// state — neither can be deleted (the config file is re-added by
				// the next boot's ensureTsconfig).
				if (name === workspace.entry || isTsconfigFile(name)) return;
				const index = workspace.files.findIndex((file) => file.name === name);
				if (index < 0) return;
				const wasCurrent = name === currentFile;
				// Drop the file's undo history along with the file itself.
				editorStates.delete(stateKey(name));
				workspace.files.splice(index, 1);
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
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void compileAndRun();
				updateHash();
			};

			controllerRef.current.renameFile = (oldName, nextName) => {
				if (disposed || !oldName || !nextName) return;
				const file = workspace.files.find(
					(candidate) => candidate.name === oldName,
				);
				// The entry file is the workspace root — its name is fixed. The
				// tsconfig file is injected state keyed by name — also fixed.
				if (!file || file.name === workspace.entry || isTsconfigFile(file.name)) return;
				const trimmed = nextName.trim();
				if (!trimmed || trimmed === oldName) return;
				// Svelte-REPL-style deconflict: keep the base name, suffix a
				// counter before the first extension (or at the end).
				let name = trimmed;
				let counter = 1;
				while (workspace.files.some((candidate) => candidate.name === name)) {
					name = trimmed.replace(/(\.|$)/, `${counter++}$1`);
				}
				file.name = name;
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
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				clearMappedIn(sourceView);
				clearMappedIn(outputView);
				lastShownEntry = null;
				lastShownAst = null;
				setInputValue(name);
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void compileAndRun();
				updateHash();
			};

			// Drag-reorder: the dropped file takes the slot the dragged file
			// was dropped on (Svelte-REPL semantics). Ordering affects nothing
			// but the hash payload, so no compile is needed.
			controllerRef.current.moveFile = (fromName, toName) => {
				if (disposed || fromName === toName) return;
				const fromIndex = workspace.files.findIndex(
					(file) => file.name === fromName,
				);
				const toIndex = workspace.files.findIndex(
					(file) => file.name === toName,
				);
				if (fromIndex < 0 || toIndex < 0) return;
				const [file] = workspace.files.splice(fromIndex, 1);
				workspace.files.splice(toIndex, 0, file);
				publishWorkspaceState();
				updateHash();
			};

			controllerRef.current.formatActive = () => {
				if (disposed) return;
				setFormatting(true);
				void (async () => {
					try {
						const { formatPlaygroundFile } = await import('./playground-format.ts');
						const source = sourceView.state.doc.toString();
						const result = await formatPlaygroundFile(currentFile, source);
						if (disposed) return;
						if (!result.ok) {
							setError(result.error);
							return;
						}
						if (result.code !== source) replaceDoc(sourceView, result.code);
					} finally {
						if (!disposed) setFormatting(false);
					}
				})();
			};

			controllerRef.current.approveRun = () => {
				if (disposed || !executionGated) return;
				executionGated = false;
				setGated(false);
				void compileAndRun();
				// The approved code is the visitor's own now — record it so a
				// reload doesn't re-gate it.
				updateHash();
			};

			controllerRef.current.syncOutput = () => {
				if (disposed) return;
				if (resultModeRef.current.view === 'compiled') {
					showOutput();
					return;
				}
				// Leaving the compiled view: marks pair with a pane no longer shown.
				clearMappedIn(sourceView);
				clearMappedIn(outputView);
			};
			controllerRef.current.ensureDevtools = () => {
				if (disposed) return;
				preview.ensureDevtools();
			};
			controllerRef.current.getTsConfig = () => parsePlaygroundTsconfig(workspace.files);
			controllerRef.current.revealAst = () => {
				if (disposed || !activeAstEntry()) return;
				astPreview.reveal(sourceView.state.selection.main.head, true);
			};

			publishWorkspaceState();
			// Seed the TypeScript worker with the workspace + its compiler
			// options; the first compileAndRun below also feeds it externals.
			scheduleTsconfigSync();
			void compileAndRun();
			if (initialDiagnostic) setError(initialDiagnostic);
			setReady(true);
		})();

		return () => {
			disposed = true;
			controllerRef.current.selectExample = undefined;
			controllerRef.current.selectFile = undefined;
			controllerRef.current.addFile = undefined;
			controllerRef.current.removeFile = undefined;
			controllerRef.current.renameFile = undefined;
			controllerRef.current.moveFile = undefined;
			controllerRef.current.formatActive = undefined;
			controllerRef.current.approveRun = undefined;
			controllerRef.current.syncOutput = undefined;
			controllerRef.current.revealAst = undefined;
			controllerRef.current.ensureDevtools = undefined;
			controllerRef.current.getTsConfig = undefined;
			window.clearTimeout(compileDebounceId);
			window.clearTimeout(hashDebounceId);
			window.clearTimeout(themeDebounceRef);
			themeObserverRef?.disconnect();
			tsSessionInstance?.dispose();
			sourceView?.destroy();
			outputView?.destroy();
			astPreview?.destroy();
			preview?.destroy();
		};
	}, []);

	return {
		view,
		pane,
		paneRef,
		error,
		ready,
		formatting,
		gated,
		exampleId,
		files,
		activeFile,
		inputValue,
		renameInputRef,
		dragOverFile,
		draggingFileRef,
		focusInputSignal,
		entryFile,
		compiledMode,
		outputTarget,
		sourceHostRef,
		outputHostRef,
		astHostRef,
		previewHostRef,
		devtoolsHostRef,
		devtoolsOpen,
		controller: controllerRef.current,
		selectView,
		openMobilePreview,
		openMobileCompiled,
		selectCompiledMode,
		selectOutputTarget,
		setPane,
		setInputValue,
		setDragOverFile,
		toggleDevtools,
	};
}
