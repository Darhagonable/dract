// The playground engine: owns every piece of interactive state and the
// imperative editor stack (the embedded VS Code workbench, the compile
// pipeline, the sandboxed preview, and the source↔output mapping). All of it
// boots once, in an effect, via dynamic imports — so SSR renders just the
// static shell and hydration stays clean. The components read state from this
// hook and drive the engine through the `controller` (see PlaygroundController).
//
// The source editor is a real VS Code workbench running the DarTsx extension's
// built .vsix in a browser extension host (see src/utils/workbench.ts) — the
// same code desktop VS Code runs provides grammar highlighting, semantic
// tokens, and diagnostics. The compiled-output editor is a plain Monaco editor
// sharing the same services and theme.
//
// The whole pipeline still runs in the browser: the `dartsx` compiler (oxc-
// parser/oxc-transform WASM bindings + esrap — no Node APIs) compiles the
// virtual files on a debounce, the module graph executes inside a SANDBOXED
// IFRAME with an opaque origin (see src/utils/playground.ts +
// playground-modules.ts + playground-sandbox.ts — never in this page).
//
// Shared links are UNTRUSTED input: a hash payload is decoded into the editor
// and compiled (source + compiled output are safe to display — compilation is
// pure string work), but it does NOT execute — even in the sandbox — until the
// visitor explicitly presses "Run" on the consent overlay. Your own edits from
// the default sources auto-run as before.
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { PlaygroundOutputTarget } from './playground.ts';
import type { CodeMapping } from './playground-mapping.ts';
import {
	decodePlaygroundHash,
	encodePlaygroundHash,
	MAX_PLAYGROUND_FILES,
	MAX_PLAYGROUND_SOURCE_LENGTH,
	PLAYGROUND_SOURCE_LIMIT_ERROR,
} from './playground-hash.ts';
import {
	TSCONFIG_FILE_NAME,
	isTsconfigFile,
	parsePlaygroundTsconfig,
	type PlaygroundFile,
} from './playground-modules.ts';
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
	 * the raw parsed JSON, or null when missing or malformed. The language
	 * worker (see src/language/) rebuilds with these compilerOptions.
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
		let workbench: any = null;
		let monacoApi: any = null;
		let outputEditor: any = null;
		let outputModel: any = null;
		let astPreview: any = null;
		let preview: any = null;
		let compileDebounceId = 0;
		let hashDebounceId = 0;
		let tsconfigReloadId = 0;
		let themeObserver: MutationObserver | null = null;
		// The language worker client (hover/diagnostics/completions) — created
		// after the workbench boots, disposed with the effect.
		let langService: import('../language/index.ts').DartsxLanguageService | null = null;
		// Validate the URL payload before loading the workbench or the
		// compiler. Oversized input is ignored in favor of the bounded defaults.
		const rawHash = window.location.hash.slice(1);
		const hashResult = decodePlaygroundHash(rawHash);
		const initial = hashResult.ok ? hashResult.value : null;
		const initialDiagnostic = hashResult.ok ? '' : hashResult.error;
		if (initialDiagnostic) setError(initialDiagnostic);

		(async () => {
			let wbMod: any, pg: any, pgModules: any, pgAst: any, pgMapping: any;
			// All dynamic imports start in parallel; only the workbench module
			// gates the editor — the compiler/wasm/output-pane chain finishes
			// loading behind it (awaited below, right before first use).
			const lateImports = Promise.all([
				import('./playground.ts'),
				import('./playground-modules.ts'),
				import('./playground-ast.ts'),
				import('./playground-mapping.ts'),
			]).then(([pg_, pgModules_, pgAst_, pgMapping_]) => {
				pg = pg_;
				pgModules = pgModules_;
				pgAst = pgAst_;
				pgMapping = pgMapping_;
			});
			lateImports.catch(() => { }); // observed via `await lateImports` below
			try {
				wbMod = await import('./workbench.ts');
			} catch (bootError) {
				// A load failure after unmount (e.g. a test env torn down mid-import)
				// must not become an unhandled rejection; while mounted, surface it.
				if (!disposed) {
					setError(bootError instanceof Error ? bootError.message : String(bootError));
				}
				return;
			}
			if (disposed) return;
			const monaco = wbMod.monaco;

			type Workspace = { files: { name: string; source: string }[]; entry: string };

			const cloneWorkspace = (workspace: Workspace): Workspace => ({
				entry: workspace.entry,
				files: workspace.files.map((file: { name: string; source: string }) => ({ ...file })),
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
				workspace.files.find((file: { name: string }) => file.name === name)?.source ?? '';

			// The worker consumes the tsconfig's compilerOptions object (it
			// feeds ts.convertCompilerOptionsFromJson directly).
			const compilerOptions = (): Record<string, unknown> | null => {
				const parsed = parsePlaygroundTsconfig(workspace.files);
				const options = (parsed as { compilerOptions?: Record<string, unknown> } | null)?.compilerOptions;
				return options && typeof options === 'object' ? options : null;
			};

			const publishWorkspaceState = () => {
				setExampleId(currentExampleId);
				setFiles(workspace.files.map((file: { name: string }) => file.name));
				setActiveFile(currentFile);
				setEntryFile(workspace.entry);
			};

			preview = pg.createPreview(previewHost, (message: string) => {
				if (!disposed) setError(message);
			}, devtoolsHostRef.current);

			const OUTPUT_PLACEHOLDER = '// Compiled output appears here.';

			// ── Workbench + editors ──────────────────────────────────────────
			// The workbench boots ONCE per page (VS Code services are singletons),
			// so a remount reuses it; the output editor is ours and disposed with
			// the effect.
			const currentThemeIsDark = () =>
				document.documentElement.getAttribute('data-theme') !== 'light';

			// While the engine applies bulk workspace updates (example switches,
			// renames), document-change events from those writes must not feed
			// back into compile/hash scheduling.
			let applyingWorkspace = false;
			// Last content accepted under the workspace size limit, per file —
			// an over-limit edit is reverted to this instead of being blocked
			// pre-transaction (Monaco notifies after the fact, unlike CodeMirror's
			// change filters).
			const lastGood = new Map<string, string>();

			const handleDocumentChanged = (name: string, text: string) => {
				if (applyingWorkspace || disposed) return;
				const others = workspace.files.reduce(
					(sum: number, file: { name: string; source: string }) => file.name === name
						? sum
						: sum + file.source.length,
					0,
				);
				if (others + text.length > MAX_PLAYGROUND_SOURCE_LENGTH) {
					setError(PLAYGROUND_SOURCE_LIMIT_ERROR);
					const model = monaco.editor.getModel(wbMod.projectUri(name));
					const good = lastGood.get(name);
					if (model && good != null && model.getValue() !== good) model.setValue(good);
					return;
				}
				lastGood.set(name, text);
				// The source half of the pair changed — orphan any marks still
				// shown in either editor.
				clearMappedPair();
				if (resultModeRef.current.mode === 'ast') {
					astPreview.setUnavailable('Waiting for the next successful compile…', currentFile);
					lastShownAst = null;
				}
				const file = workspace.files.find(
					(candidate: { name: string }) => candidate.name === name,
				);
				if (file) file.source = text;
				// tsconfig edits recreate the language worker (debounced) —
				// vue-repl's reloadLanguageTools pattern: dispose, rebuild
				// with fresh compiler options, re-register providers.
				if (isTsconfigFile(name)) {
					window.clearTimeout(tsconfigReloadId);
					tsconfigReloadId = window.setTimeout(() => {
						if (!disposed) createLanguageService();
					}, 500);
				}
				// Any edit means the buffer no longer matches the example.
				if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
					currentExampleId = CUSTOM_EXAMPLE_ID;
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				scheduleCompile();
				updateHash();
			};

			workbench = await wbMod.bootWorkbench({
				container: sourceHost,
				files: workspace.files,
				entry: workspace.entry,
				dark: currentThemeIsDark(),
				onDocumentChanged: handleDocumentChanged,
			});
			monacoApi = wbMod.monaco;
			if (disposed) return;

			// The editor mounts as soon as the workbench exists — "Loading
			// editor…" ends HERE, not after the compiler/output-pane chain.
			// Grammar colors arrive when the extension finishes activating in
			// the background (workbench.ts).
			await workbench.openFile(workspace.entry);
			setActiveFile(workspace.entry);
			setReady(true);

			// TypeScript features run in the language worker, off the UI
			// thread (see src/language/). Same DarTsx transform + filters as
			// the desktop tsserver plugin; the tsconfig drives its options.
			// vue-repl wiring (@volar/monaco) over our worker transport.
			let langMod: typeof import('../language/index.ts') | null = null;
			const projectModelUris = () =>
				monaco.editor.getModels()
					.filter((model: any) => projectName(model.uri) !== null)
					.map((model: any) => model.uri);
			const createLanguageService = () => {
				langService?.dispose();
				langService = langMod?.createDartsxLanguageService(
					projectModelUris,
					() => compilerOptions(),
				) ?? null;
			};
			void (async () => {
				try {
					langMod = await import('../language/index.ts');
					if (!disposed) createLanguageService();
				} catch (langError) {
					console.warn('[dartsx-playground] language service unavailable', langError);
				}
			})();

			// Everything past this point needs the compiler/output chain.
			try {
				await lateImports;
			} catch (bootError) {
				if (!disposed) {
					setError(bootError instanceof Error ? bootError.message : String(bootError));
				}
				return;
			}
			if (disposed) return;

			themeObserver = new MutationObserver(() => {
				workbench.setTheme(currentThemeIsDark());
			});
			themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

			outputModel = monaco.editor.createModel(
				OUTPUT_PLACEHOLDER,
				'typescript',
				monaco.Uri.parse('dartsx-output:/client'),
			);
			// The compiled-output editor: shares the engine's theme and
			// configuration services (createEditor wires them; plain
			// monaco.editor.create would render unthemed).
			outputEditor = wbMod.createEditor(outputHost, {
				model: outputModel,
				readOnly: true,
				lineNumbers: 'on',
				minimap: { enabled: false },
				wordWrap: 'on',
				scrollBeyondLastLine: false,
				automaticLayout: true,
				renderLineHighlight: 'none',
			});

			// ── Source ↔ output position mapping ─────────────────────────────
			// Placing the cursor in one editor highlights and reveals the mapped
			// ranges in the other (see playground-mapping.ts for the semantics).
			// Marks belong to the exact (source doc, output doc) PAIR they were
			// computed against, so a change to either side clears BOTH editors.
			const decorationsByEditor = new Map<any, any>();
			const decorationsFor = (target: any) => {
				let collection = decorationsByEditor.get(target);
				if (!collection) {
					collection = target.createDecorationsCollection([]);
					decorationsByEditor.set(target, collection);
				}
				return collection;
			};
			const clearMappedIn = (target: any) => {
				if (!target) return;
				decorationsFor(target).set([]);
			};

			// The exact string the output editor currently displays. The output
			// model is read-only and written ONLY here, so this makes both the
			// refresh no-op check and activeMapping's staleness check a string
			// reference compare instead of an O(doc) getValue per call.
			let lastShownOutput = OUTPUT_PLACEHOLDER;
			// The entry + target that produced the current document — the
			// mapping owner for whatever the output editor displays, so per-cursor
			// lookups never re-derive which pipeline/target the pane is on.
			let lastShownEntry: { entry: CodeEntry; target: PlaygroundOutputTarget } | null = null;
			// The AST currently shown, with the source it was built from.
			let lastShownAst: { ast: unknown; source: string } | null = null;

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
				} else if (pgModules.isReactHostFile(name)) {
					const compiled = pgModules.peekCompiledFile({ name, source });
					entry = compiled
						? compiled.ok
						? { source, code: compiled.code, ast: null, map: null, error: null }
						: {
								source,
								code: '// Compiled output failed:\n// ' + compiled.error,
								ast: null,
								map: null,
								error: compiled.error,
							}
					// A missed cache hit here means the graph hasn't compiled
					// since the file was edited — but the placeholder cannot
					// outlive the compile that replaces it.
					: {
							source,
							code: '// Compiled output appears after the next compile.',
							ast: null,
							map: null,
							error: null,
						};
				} else {
					const output = pgModules.getModuleOutput(name);
					const error = pgModules.compileError(name);
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

			// Server/Types have no emit yet — the code pane shows a status line
			// and there is nothing to inspect. The AST pane gets an empty tree.
			const placeholderEntry = (code: string): CodeEntry => ({
				source: '',
				code,
				ast: null,
				map: null,
				error: null,
			});

			// Built once per (entry, target) and cached on the entry, so a
			// mousemove stream costs one property read.
			const buildMapping = (entry: CodeEntry, target: PlaygroundOutputTarget) => {
				if (target !== 'client' || !entry.map) return null;
				return pgMapping.mappingFromSourceMap(entry.source, entry.code, entry.map);
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

			// Offset → Range clamped to the model; invalid ranges drop out.
			const rangesFor = (model: any, ranges: { from: number; to: number }[]) => {
				const limit = model.getValueLength();
				const out: { range: any; offset: number }[] = [];
				for (const range of ranges) {
					const to = Math.min(range.to, limit);
					if (range.from >= 0 && range.from < to) {
						out.push({
							range: new monaco.Range(
								model.getPositionAt(range.from),
								model.getPositionAt(to),
							),
							offset: range.from,
						});
					}
				}
				return out;
			};

			const revealRanges = (
				target: any,
				ranges: { from: number; to: number }[],
				scroll: boolean,
			) => {
				if (!target) return;
				const model = target.getModel();
				if (!model) return;
				const mapped = rangesFor(model, ranges);
				if (mapped.length === 0) {
					// Same contract as an unmapped position: no lingering marks.
					clearMappedIn(target);
					return;
				}
				decorationsFor(target).set(
					mapped.map(({ range }) => ({ range, options: { className: 'pg-mapped' } })),
				);
				// Jump to the DEFINITION when one of the mapped ranges is a declared
				// name: a directive arm maps both to `function __case$0(…)` and to
				// where that name is handed to the runtime, and the implementation is
				// what you want to read. Every range still gets a mark either way.
				if (scroll) {
					const textBefore = (offset: number) => {
						const start = model.getPositionAt(Math.max(0, offset - 12));
						const end = model.getPositionAt(offset);
						return model.getValueInRange({
							startLineNumber: start.lineNumber,
							startColumn: start.column,
							endLineNumber: end.lineNumber,
							endColumn: end.column,
						});
					};
					const preferred =
						mapped.find(({ offset }) => DECLARATION_BEFORE.test(textBefore(offset)))
							?? mapped[0];
					target.revealRangeInCenter(preferred.range);
				}
			};

			const mappedPair = (side: 'source' | 'output', offset: number) => {
				const mapping = activeMapping();
				if (!mapping) return null;
				return side === 'source'
					? mapping.pairFromSource(offset)
					: mapping.pairFromGenerated(offset);
			};
			const sourceEditor = () => workbench.getActiveEditor() as any;
			const clearMappedPair = () => {
				clearMappedIn(sourceEditor());
				clearMappedIn(outputEditor);
			};
			const revealPair = (
				pair: { source: { from: number; to: number }[]; output: { from: number; to: number }[] },
				scrollSide: 'source' | 'output' | null,
			) => {
				// Only a deliberate move — a click or a cursor placement — takes the
				// other pane somewhere. Hover marks in place and never steals scroll,
				// so a mapped range far from the hovered line is marked but stays
				// where it is until you click.
				revealRanges(sourceEditor(), pair.source, scrollSide === 'source');
				revealRanges(outputEditor, pair.output, scrollSide === 'output');
			};
			const revealAstRange = (range: { from: number; to: number } | null, scroll: boolean) => {
				if (resultModeRef.current.mode !== 'ast') return;
				if (!range || !activeAstEntry()) {
					clearMappedPair();
					return;
				}
				clearMappedIn(outputEditor);
				revealRanges(sourceEditor(), [range], scroll);
			};

			astPreview = pgAst.createAstPreview(astHost, {
				onNodeRange: revealAstRange,
			});

			// Which side of the pair does this editor hold? Project files are the
			// source half; our dedicated output model is the other.
			const sideOf = (target: any): 'source' | 'output' | null => {
				const model = target.getModel();
				if (!model) return null;
				if (model === outputModel) return 'output';
				return wbMod.projectName(model.uri) ? 'source' : null;
			};

			// Hovering either document highlights the corresponding ranges without
			// moving its scroll position; clicking/cursor movement above
			// additionally reveals them. Listeners attach per editor control; the
			// side is derived from the current model, so file switches need no
			// rewiring.
			const wiredEditors = new WeakSet<object>();
			const wireEditor = (target: any) => {
				if (!target || wiredEditors.has(target)) return;
				wiredEditors.add(target);

				target.onMouseMove((event: any) => {
					if (resultModeRef.current.view !== 'compiled') return;
					const side = sideOf(target);
					if (!side) return;
					const model = target.getModel();
					const position = event.target?.position;
					if (!position) return;
					const offset = model.getOffsetAt(position);
					if (resultModeRef.current.mode === 'ast') {
						if (!activeAstEntry()) clearMappedPair();
						else astPreview.reveal(offset, false);
						return;
					}
					const pair = mappedPair(side, offset);
					if (pair) revealPair(pair, null);
					else clearMappedPair();
				});
				target.onMouseLeave(() => {
					// The browser can deliver mouseleave before the mobile pane's
					// display:none reaches layout. The synchronous pane ref makes
					// that stale event harmless from the instant Inspect is clicked.
					const side = sideOf(target);
					if (
						side === 'source' && paneRef.current === 'result' &&
							window.matchMedia('(max-width: 980px)').matches
					) return;
					clearMappedPair();
					astPreview.clear();
				});
				// Only user-driven cursor moves navigate — programmatic ones
				// (reveals, doc replacement) must not feed back. Monaco exposes the
				// reason; NotSet covers the programmatic bulk.
				target.onDidChangeCursorPosition((event: any) => {
					if (event.reason === monaco.editor.CursorChangeReason.NotSet) return;
					if (resultModeRef.current.view !== 'compiled') return;
					const side = sideOf(target);
					if (!side) return;
					const model = target.getModel();
					const offset = model.getOffsetAt(event.position);
					if (resultModeRef.current.mode === 'ast') {
						if (activeAstEntry()) astPreview.reveal(offset, true);
						return;
					}
					const pair = mappedPair(side, offset);
					// Marks reflect the CURRENT selection — an unmapped one clears.
					if (pair) revealPair(pair, side === 'source' ? 'output' : 'source');
					else clearMappedPair();
				});
			};
			monaco.editor.onDidCreateEditor(wireEditor);
			for (const candidate of monaco.editor.getEditors()) wireEditor(candidate);

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
				// The compiled pane is not visible: skip entirely. syncOutput re-runs
				// this when the pane is revealed, so it refreshes exactly once, on
				// demand.
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
						const message = pgModules.isReactHostFile(currentFile)
							? 'AST trace covers Octane-owned .tsx files. React-host files use the separate Sucrase pipeline.'
							: 'AST generation failed. Fix the source to generate a new tree.';
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
				// A refresh that lands on the SAME artifact must leave marks alone:
				// identity is the conservative test (entries are cached per
				// (file, target, source); any miss yields a fresh object).
				const sameArtifact = output === lastShownEntry?.entry && code === lastShownOutput;
				if (!sameArtifact) {
					clearMappedPair();
					astPreview.clear();
				}
				// Preserve a graph-level error when switching output artifacts.
				setError(output.error || lastGraphError);
				lastShownEntry = { entry: output, target };
				if (typeof code !== 'string' || code === lastShownOutput) return output.error;
				applyingWorkspace = true;
				try {
					outputModel.setValue(code);
					monaco.editor.setModelLanguage?.(
						outputModel,
						isTsconfigFile(currentFile) ? 'json' : 'typescript',
					);
				} finally {
					applyingWorkspace = false;
				}
				lastShownOutput = code;
				// The output half of the pair changed — source marks were computed
				// against the previous artifact.
				clearMappedIn(sourceEditor());
				return output.error;
			};

			let compileSeq = 0;
			const compileAndRun = async () => {
				if (disposed) return;
				const seq = ++compileSeq;
				const { files: wsFiles, entry } = workspace;
				const total = wsFiles.reduce(
					(sum: number, file: { source: string }) => sum + file.source.length,
					0,
				);
				if (total > MAX_PLAYGROUND_SOURCE_LENGTH) {
					setError(PLAYGROUND_SOURCE_LIMIT_ERROR);
					return;
				}
				const graph = await pgModules.buildModuleGraph(wsFiles, entry);
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

			// Reflect a full workspace replacement (example switch) in the FS and
			// models: update surviving documents, register newcomers, delete the
			// rest. Undo history resets here deliberately — the original engine
			// also dropped per-file states on an example switch.
			const syncWorkbenchToWorkspace = async () => {
				applyingWorkspace = true;
				try {
					const nextNames = new Set(workspace.files.map((f: { name: string }) => f.name));
					for (const file of workspace.files) {
						registerWorkspaceFile(file.name, file.source);
						lastGood.set(file.name, file.source);
						// A model per file keeps cross-file type checking live
						// across the switch (see workbench.ts).
						await wbMod.ensureWorkspaceModel(file.name);
						const model = monaco.editor.getModel(projectUri(file.name));
						if (model && model.getValue() !== file.source) model.setValue(file.source);
					}
					for (const model of monaco.editor.getModels()) {
						const name = projectName(model.uri);
						if (name && !nextNames.has(name)) model.dispose();
					}
					for (const name of [...wbMod.registeredNames]) {
						if (!nextNames.has(name)) wbMod.unregisterWorkspaceFile(name);
					}
				} finally {
					applyingWorkspace = false;
				}
			};

			const projectUri = (name: string) => wbMod.projectUri(name);
			const projectName = (uri: any) => wbMod.projectName(uri);
			const registerWorkspaceFile = (name: string, source: string) =>
				wbMod.registerWorkspaceFile(name, source);

			const openFile = async (name: string) => {
				currentFile = name;
				await workbench.openFile(name);
				// Marks pair with the previous (doc, doc) pair — stale now.
				clearMappedIn(sourceEditor());
				clearMappedIn(outputEditor);
				setActiveFile(name);
				showOutput();
			};

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
				runtimeCache.clear();
				lastShownEntry = null;
				lastShownAst = null;
				// Picking an example is the visitor's own action — never gated.
				executionGated = false;
				setGated(false);
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void (async () => {
					await syncWorkbenchToWorkspace();
					if (disposed) return;
					currentFile = workspace.entry;
					await workbench.openFile(currentFile);
					setActiveFile(currentFile);
					clearMappedPair();
					void compileAndRun();
					updateHash();
				})();
			};

			controllerRef.current.selectFile = (name) => {
				if (disposed || name === currentFile) return;
				if (!workspace.files.some((file: { name: string }) => file.name === name)) return;
				void openFile(name);
			};

			// Svelte-REPL-style file management. A new file is a plain comment —
			// valid for any file kind, so it compiles into a runnable graph while
			// the visitor decides what it becomes.
			const NEW_FILE_SOURCE = '// New file — replace this with your code.';
			const nextFileName = () => {
				const names = new Set(workspace.files.map((file: { name: string }) => file.name));
				let index = 1;
				let name = 'File.tsx';
				while (names.has(name)) name = `File-${++index}.tsx`;
				return name;
			};

			controllerRef.current.addFile = () => {
				if (disposed || workspace.files.length >= MAX_PLAYGROUND_FILES) return;
				const name = nextFileName();
				workspace.files.push({ name, source: NEW_FILE_SOURCE });
				registerWorkspaceFile(name, NEW_FILE_SOURCE);
				void wbMod.ensureWorkspaceModel(name);
				lastGood.set(name, NEW_FILE_SOURCE);
				// Any structural change means the buffer no longer matches the
				// example (the same flip edits perform).
				if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
					currentExampleId = CUSTOM_EXAMPLE_ID;
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				setInputValue(name);
				setFocusInputSignal((n) => n + 1);
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void (async () => {
					await openFile(name);
					void compileAndRun();
					updateHash();
				})();
			};

			const deleteProjectFile = (name: string) => {
				const model = monaco.editor.getModel(projectUri(name));
				model?.dispose();
				wbMod.unregisterWorkspaceFile(name);
			};

			controllerRef.current.removeFile = (name) => {
				if (disposed || workspace.files.length <= 1) return;
				// The entry is the workspace root and the tsconfig is injected
				// state — neither can be deleted (the config file is re-added by
				// the next boot's ensureTsconfig).
				if (name === workspace.entry || isTsconfigFile(name)) return;
				const index = workspace.files.findIndex((file: { name: string }) => file.name === name);
				if (index < 0) return;
				const wasCurrent = name === currentFile;
				workspace.files.splice(index, 1);
				// The compile cache is keyed by file name — purge the deleted one
				// rather than churn every key. Nothing else references them.
				runtimeCache.delete(name);
				lastGood.delete(name);
				void deleteProjectFile(name);
				if (wasCurrent) {
					// Fall to the file that took the tab's place, wrapping to the
					// first when the last file was deleted.
					const next = workspace.files[Math.min(index, workspace.files.length - 1)];
					currentFile = next.name;
				}
				clearMappedPair();
				lastShownEntry = null;
				lastShownAst = null;
				if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
					currentExampleId = CUSTOM_EXAMPLE_ID;
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void (async () => {
					await openFile(currentFile);
					void compileAndRun();
					updateHash();
				})();
			};

			controllerRef.current.renameFile = (oldName, nextName) => {
				if (disposed || !oldName || !nextName) return;
				const file = workspace.files.find(
					(candidate: { name: string }) => candidate.name === oldName,
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
				while (workspace.files.some((candidate: { name: string }) => candidate.name === name)) {
					name = trimmed.replace(/(\.|$)/, `${counter++}$1`);
				}
				file.name = name;
				if (currentFile === oldName) currentFile = name;
				// The compile cache is keyed by file name — drop the old key so
				// the next compile repopulates it under the new name.
				runtimeCache.delete(oldName);
				const good = lastGood.get(oldName);
				lastGood.delete(oldName);
				if (good != null) lastGood.set(name, good);
				registerWorkspaceFile(name, file.source);
				void wbMod.ensureWorkspaceModel(name);
				void deleteProjectFile(oldName);
				// A rename makes the buffer non-example, like any edit.
				if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
					currentExampleId = CUSTOM_EXAMPLE_ID;
					setExampleId(CUSTOM_EXAMPLE_ID);
				}
				clearMappedPair();
				lastShownEntry = null;
				lastShownAst = null;
				setInputValue(name);
				publishWorkspaceState();
				window.clearTimeout(compileDebounceId);
				void (async () => {
					await openFile(name);
					void compileAndRun();
					updateHash();
				})();
			};

			// Drag-reorder: the dropped file takes the slot the dragged file
			// was dropped on (Svelte-REPL semantics). Ordering affects nothing
			// but the hash payload, so no compile is needed.
			controllerRef.current.moveFile = (fromName, toName) => {
				if (disposed || fromName === toName) return;
				const fromIndex = workspace.files.findIndex(
					(file: { name: string }) => file.name === fromName,
				);
				const toIndex = workspace.files.findIndex(
					(file: { name: string }) => file.name === toName,
				);
				if (fromIndex < 0 || toIndex < 0) return;
				const [file] = workspace.files.splice(fromIndex, 1);
				workspace.files.splice(toIndex, 0, file);
				publishWorkspaceState();
				updateHash();
			};

			controllerRef.current.formatActive = () => {
				if (disposed) return;
				const editorInstance = sourceEditor();
				const model = editorInstance?.getModel();
				if (!model || !projectName(model.uri)) return;
				setFormatting(true);
				void (async () => {
					try {
						const { formatPlaygroundFile } = await import('./playground-format.ts');
						const source = model.getValue();
						const result = await formatPlaygroundFile(currentFile, source);
						if (disposed) return;
						if (!result.ok) {
							setError(result.error);
							return;
						}
						if (result.code !== source) {
							editorInstance.executeEdits('dartsx-format', [{
								range: model.getFullModelRange(),
								text: result.code,
								forceMoveMarkers: false,
							}]);
						}
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
				clearMappedPair();
			};
			controllerRef.current.ensureDevtools = () => {
				if (disposed) return;
				preview.ensureDevtools();
			};
			controllerRef.current.getTsConfig = () => parsePlaygroundTsconfig(workspace.files);
			controllerRef.current.revealAst = () => {
				if (disposed || !activeAstEntry()) return;
				const editorInstance = sourceEditor();
				const model = editorInstance?.getModel();
				const position = editorInstance?.getPosition();
				if (!model || !position) return;
				astPreview.reveal(model.getOffsetAt(position), true);
			};

			// Mod-Shift-f formats the active source editor (the old CodeMirror
			// keymap binding). Scoped to the workbench container so browser
			// defaults elsewhere are untouched.
			const keyHandler = (event: KeyboardEvent) => {
				if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
					if (!sourceHost.contains(event.target as Node)) return;
					event.preventDefault();
					event.stopPropagation();
					controllerRef.current.formatActive?.();
				}
			};
			sourceHost.addEventListener('keydown', keyHandler, true);

			// The editor itself already mounted and `ready` flipped early
			// (right after bootWorkbench); this full open also wires the
			// output-pane bookkeeping that didn't exist yet back then.
			await openFile(currentFile);
			publishWorkspaceState();
			void compileAndRun();
			if (initialDiagnostic) setError(initialDiagnostic);
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
			window.clearTimeout(tsconfigReloadId);
			themeObserver?.disconnect();
			langService?.dispose();
			langService = null;
			outputEditor?.dispose();
			outputModel?.dispose();
			astPreview?.destroy();
			preview?.destroy();
			// The workbench itself is a page-wide singleton (see workbench.ts):
			// it survives remounts and is reused via bootPromise.
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
