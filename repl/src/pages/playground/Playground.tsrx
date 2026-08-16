// /playground — write TSX on the left, and on the right either the
// LIVE rendered app or the compiled output, switchable with a tab. The
// compiled pane selects a Client, Server, or Types artifact and shows it as
// code or an AST. Server and Types are kept as
// targets for future DarTsx emits (a server renderer, .d.ts output) and show
// a placeholder until then. Hovering or selecting source reveals the
// corresponding AST node where the parser has a span; hovering a tree node
// highlights its origin document. In code form the Client target maps BOTH
// ways — through the compile's source map, widened with verified text matches
// (see playground-mapping.ts). The
// whole pipeline runs in the browser: the `dartsx` compiler (oxc-parser/
// oxc-transform WASM bindings + esrap — no Node APIs) compiles the virtual
// files on a debounce, the module graph executes inside a SANDBOXED IFRAME
// with an opaque origin (see src/lib/playground.ts + playground-modules.ts +
// playground-sandbox.ts — never in this page), and CodeMirror highlights
// through Shiki with the bundled TSX grammar (src/lib/shiki-codemirror.ts).
// Editors, panels, and the preview canvas all follow the site's light/dark
// theme.
//
// Everything editor-related boots in an effect (dynamic imports), so SSR
// renders just the static shell and hydration stays clean. A workspace is a
// set of virtual files with an entry. The Examples dropdown
// loads curated workspaces from repl/examples/ (src/lib/playground-examples.ts);
// the file tabs manage the file set (add/delete), and editing any file
// flips it to “Custom”. The active workspace persists into `location.hash`
// (debounced) so playground states are shareable links, and the Format button
// runs client-side Prettier (src/lib/playground-format.ts).
//
// Shared links are UNTRUSTED input: a hash payload is decoded into the editor
// and compiled (source + compiled output are safe to display — compilation is
// pure string work), but it does NOT execute — even in the sandbox — until the
// visitor explicitly presses "Run" on the consent overlay. Your own edits from
// the default sources auto-run as before.
import { useState, useRef, useEffect } from 'octane';
import type { PlaygroundOutputTarget } from '../../lib/playground.ts';
import type { CodeMapping } from '../../lib/playground-mapping.ts';
import {
	decodePlaygroundHash,
	encodePlaygroundHash,
	MAX_PLAYGROUND_FILES,
	MAX_PLAYGROUND_SOURCE_LENGTH,
	PLAYGROUND_SOURCE_LIMIT_ERROR,
} from '../../lib/playground-hash.ts';
import * as pgExamples from '../../lib/playground-examples.ts';
import { useTitle } from '../../hooks/use-title.ts';

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

const OUTPUT_TARGET_LABEL: Record<PlaygroundOutputTarget, string> = {
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

export function Playground() @{
	useTitle('Octane — Playground');
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
	// The boot closure runs once, so it can't read the view STATE — this ref
	// mirrors it (updated by the same handlers that set state) for the
	// closure's output-refresh path.
	const resultModeRef = useRef<{ view: 'preview' | 'compiled'; mode: 'code' | 'ast'; target: PlaygroundOutputTarget }>({
		view: 'preview',
		mode: 'code',
		target: 'client',
	});
	// Imperative bridge into the boot closure below — populated once the editor
	// stack has loaded; the toolbar buttons (and the consent overlay's Run
	// button) call through it.
	const controllerRef = useRef<{
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
	}>({});

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
		let sourceView: any;
		let outputView: any;
		let astPreview: any;
		let preview: any = null;
		let compileDebounceId = 0;
		let hashDebounceId = 0;
		// Validate the URL payload before loading CodeMirror, Shiki, or the
		// compiler. Oversized input is ignored in favor of the bounded defaults.
		const rawHash = window.location.hash.slice(1);
		const hashResult = decodePlaygroundHash(rawHash);
		const initial = hashResult.ok ? hashResult.value : null;
		const initialDiagnostic = hashResult.ok ? '' : hashResult.error;
		if (initialDiagnostic) setError(initialDiagnostic);

		(async () => {
			let stateMod: any, commandsMod: any, viewMod: any, shikiMod: any, pg: any, pgModules: any, pgAst: any, pgMapping: any;
			try {
				[stateMod, commandsMod, viewMod, shikiMod, pg, pgModules, pgAst, pgMapping] = await Promise.all([
					import('@codemirror/state'),
					import('@codemirror/commands'),
					import('@codemirror/view'),
					import('../../lib/shiki-codemirror.ts'),
					import('../../lib/playground.ts'),
					import('../../lib/playground-modules.ts'),
					import('../../lib/playground-ast.ts'),
					import('../../lib/playground-mapping.ts'),
				]);
			} catch (bootError) {
				// A load failure after unmount (e.g. a test env torn down mid-import)
				// must not become an unhandled rejection; while mounted, surface it.
				if (!disposed) {
					setError(bootError instanceof Error ? bootError.message : String(bootError));
				}
				return;
			}
			if (disposed) return;

			const { EditorState, Compartment, StateEffect, StateField } = stateMod;
			const { history, defaultKeymap, historyKeymap, indentWithTab } = commandsMod;
			const {
				EditorView,
				keymap,
				lineNumbers,
				highlightActiveLine,
				drawSelection,
				Decoration,
			} = viewMod;
			const { shikiHighlight } = shikiMod;

			type Workspace = { files: { name: string; source: string }[]; entry: string };

			const cloneWorkspace = (workspace: Workspace): Workspace => ({
				entry: workspace.entry,
				files: workspace.files.map((file: { name: string; source: string }) => ({ ...file })),
			});

			let currentExampleId: string = initial ? CUSTOM_EXAMPLE_ID : DEFAULT_EXAMPLE_ID;
			let workspace: Workspace = cloneWorkspace(pgExamples.DEFAULT_WORKSPACE);
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
			let currentFile = workspace.entry;

			const fileSource = (name: string): string =>
				workspace.files.find((file: { name: string }) => file.name === name)?.source ?? '';

		const publishWorkspaceState = () => {
			setExampleId(currentExampleId);
			setFiles(workspace.files.map((file: { name: string }) => file.name));
			setActiveFile(currentFile);
			setEntryFile(workspace.entry);
		};

			// Theme-variable canvas: the same custom properties the rest of the
			// site swaps per `data-theme`, so both editors follow the ThemeToggle
			// live (token colors flip through the dual-theme .cm-shiki rules).
			const sharedTheme = EditorView.theme({
				'&': {
					height: '100%',
					backgroundColor: 'var(--code-bg)',
					color: 'var(--text)',
					fontSize: '0.85rem',
				},
				'.cm-scroller': {
					overflow: 'auto',
					fontFamily: 'ui-monospace, SFMono-Regular, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace',
				},
				'.cm-content': { padding: '1rem 0.25rem 1.25rem' },
				'.cm-gutters': {
					backgroundColor: 'var(--code-bg)',
					color: 'var(--text-secondary)',
					border: 'none',
					opacity: '0.7',
				},
				'.cm-activeLine, .cm-activeLineGutter': {
					backgroundColor: 'var(--surface)',
				},
				'.cm-selectionBackground': {
					backgroundColor: 'rgba(56, 139, 253, 0.35) !important',
				},
				'.cm-cursor': { borderLeftColor: 'var(--text)' },
			});

			preview = pg.createPreview(previewHost, (message: string) => {
				if (!disposed) setError(message);
			});

			const replaceDoc = (view: any, doc: string) => {
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
				if (pgModules.isReactHostFile(name)) {
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
			const setMapped = StateEffect.define();
			const mappedMark = Decoration.mark({ class: 'cm-mapped' });
			const mappedField = StateField.define({
				create: () => Decoration.none,
				update(value: any, tr: any) {
					for (const effect of tr.effects) if (effect.is(setMapped)) return effect.value;
					// Any edit (or an output refresh) invalidates the offsets.
					return tr.docChanged ? Decoration.none : value;
				},
				provide: (field: any) => EditorView.decorations.from(field),
			});
			// Per-keystroke safe: one O(1) field-size read, and a transaction is
			// dispatched only when marks actually exist to clear.
			const clearMappedIn = (targetView: any) => {
				if (targetView.state.field(mappedField, false)?.size) {
					targetView.dispatch({ effects: setMapped.of(Decoration.none) });
				}
			};
			// Does the view already show exactly `ranges` (sorted, as the mapping
			// and AST paths produce them)?
			const sameMarks = (targetView: any, ranges: { from: number; to: number }[]) => {
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

			const revealRanges = (
				targetView: any,
				ranges: { from: number; to: number }[],
				scroll: boolean,
			) => {
				const limit = targetView.state.doc.length;
				const clamped = ranges.map(
					(range: { from: number; to: number }) => ({
						from: range.from,
						to: Math.min(range.to, limit),
					}),
				).filter((range: { from: number; to: number }) => range.from >= 0 && range.from < range.to);
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
				const effects = [
					setMapped.of(
						Decoration.set(
							clamped.map(
								(range: { from: number; to: number }) => mappedMark.range(range.from, range.to),
							),
						),
					),
				];
				// Jump to the DEFINITION when one of the mapped ranges is a declared
				// name: a directive arm maps both to `function __case$0(…)` and to
				// where that name is handed to the runtime, and the implementation is
				// what you want to read. Every range still gets a mark either way.
				if (scroll) {
					const declared =
						clamped.find(
							(range: { from: number; to: number }) => DECLARATION_BEFORE.test(
								targetView.state.doc.sliceString(Math.max(0, range.from - 12), range.from),
							),
						) ??
							clamped[0];
					effects.push(EditorView.scrollIntoView(declared.from, { y: 'center' }));
				}
				targetView.dispatch({ effects });
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

			astPreview = pgAst.createAstPreview(astHost, {
				onNodeRange: revealAstRange,
			});

			const crossNavigate = (side: 'source' | 'output') => EditorView.updateListener.of((
				update: any,
			) => {
				if (!update.selectionSet || update.docChanged) return;
				// Only user-driven cursor moves navigate — programmatic dispatches
				// (doc replacement, highlight effects) must not feed back.
				if (!update.transactions.some((tr: any) => tr.isUserEvent('select'))) return;
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
				mousemove(event: MouseEvent, view: any) {
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
				// generation, no doc replacement, and (the dominant cost) no Shiki
				// re-tokenize of the output document. syncOutput re-runs this when
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

			// One writable EditorView; each file keeps its own EditorState (undo
			// history included), keyed per file.
			const editorStates = new Map<string, any>();
			const stateKey = (name: string) => name;

			const makeEditorState = (name: string, doc: string) => EditorState.create({
				doc,
				extensions: [
					EditorState.changeFilter.of((transaction: any) => {
						if (!transaction.docChanged) return true;
						const others = workspace.files.reduce(
							(sum: number, file: { name: string; source: string }) => file.name === currentFile
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
					shikiHighlight('tsx'),
					sharedTheme,
					mappedField,
					crossHover('source'),
					crossNavigate('source'),
					EditorView.updateListener.of((update: any) => {
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
							(candidate: { name: string }) => candidate.name === currentFile,
						);
						if (file) file.source = next;
						// Any edit means the buffer no longer matches the example.
						if (currentExampleId !== CUSTOM_EXAMPLE_ID) {
							currentExampleId = CUSTOM_EXAMPLE_ID;
							setExampleId(CUSTOM_EXAMPLE_ID);
						}
						scheduleCompile();
						updateHash();
					}),
				],
			});

			const openFile = (name: string) => {
				editorStates.set(stateKey(currentFile), sourceView.state);
				currentFile = name;
				const existing = editorStates.get(stateKey(name));
				sourceView.setState(existing ?? makeEditorState(name, fileSource(name)));
				// setState fires no transaction: a restored state may carry marks
				// from an old pair, and the output's marks belong to the old file.
				clearMappedIn(sourceView);
				clearMappedIn(outputView);
				setActiveFile(name);
				showOutput();
			};

			sourceView = new EditorView({
				state: makeEditorState(currentFile, fileSource(currentFile)),
				parent: sourceHost,
			});

			outputView = new EditorView({
				state: EditorState.create({
					doc: OUTPUT_PLACEHOLDER,
					extensions: [
						lineNumbers(),
						EditorState.readOnly.of(true),
						EditorView.editable.of(false),
						EditorView.lineWrapping,
						shikiHighlight('tsx'),
						sharedTheme,
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
				workspace = pgExamples.exampleWorkspace(example);
				currentFile = workspace.entry;
				editorStates.clear();
				runtimeCache.clear();
				lastShownEntry = null;
				lastShownAst = null;
				sourceView.setState(makeEditorState(currentFile, fileSource(currentFile)));
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
				if (!workspace.files.some((file: { name: string }) => file.name === name)) return;
				openFile(name);
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
				if (name === workspace.entry) return;
				const index = workspace.files.findIndex((file: { name: string }) => file.name === name);
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
					sourceView.setState(existing ?? makeEditorState(currentFile, fileSource(currentFile)));
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
					(candidate: { name: string }) => candidate.name === oldName,
				);
				// The entry file is the workspace root — its name is fixed.
				if (!file || file.name === workspace.entry) return;
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
				setFormatting(true);
				void (async () => {
					try {
						const { formatPlaygroundFile } = await import('../../lib/playground-format.ts');
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
			controllerRef.current.revealAst = () => {
				if (disposed || !activeAstEntry()) return;
				astPreview.reveal(sourceView.state.selection.main.head, true);
			};

			publishWorkspaceState();
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
			window.clearTimeout(compileDebounceId);
			window.clearTimeout(hashDebounceId);
			sourceView?.destroy();
			outputView?.destroy();
			astPreview?.destroy();
			preview?.destroy();
		};
	}, []);

	<div class="pg">
		<div class="pg-toolbar">
			<div class="pg-toolbar-side">
				<select
					class="pg-select"
					aria-label="Example"
					disabled={!ready}
					value={exampleId}
					onChange={(e) => controllerRef.current.selectExample?.(e.currentTarget.value)}
				>
					{/* Static placeholder shown only while the buffer has diverged from
    every example — always in the DOM (no conditional rendering
    inside the select) so the option list never reconciles. */}
					<option value="custom" disabled hidden>Custom</option>
					@for (const group of EXAMPLE_GROUPS; key group.group) {
						<optgroup label={group.group}>
							@for (const example of group.examples; key example.id) {
								<option value={example.id}>{example.label as string}</option>
							}
						</optgroup>
					}
				</select>
				<button
					type="button"
					class="pg-format"
					disabled={!ready || formatting}
					title="Format with Prettier (Ctrl/Cmd-Shift-F)"
					onClick={() => controllerRef.current.formatActive?.()}
				>{(formatting ? 'Formatting…' : 'Format') as string}</button>
			</div>
			<div class="pg-seg pg-view-switch" role="group" aria-label="Result view">
				<button
					type="button"
					class={['pg-seg-btn', view === 'preview' && 'active']}
					onClick={() => selectView('preview')}
				>
					Preview
				</button>
				<button
					type="button"
					class={['pg-seg-btn', view === 'compiled' && 'active']}
					onClick={() => selectView('compiled')}
				>
					Compiled
				</button>
			</div>
		</div>

		@if (error) {
			<div class="pg-error" role="alert">{error}</div>
		}

		<div class={['pg-grid', ready && 'ready']}>
			<section
				class={['pg-panel', pane !== 'editor' && 'mobile-hidden']}
				aria-label="Source editor"
			>
				<div class="pg-panel-head">
					<div class="pg-tabs" role="tablist" aria-label="Playground files">
						@for (const name of files; key name) {
							<div
								class={['pg-tab', name === activeFile && 'active', dragOverFile === name && 'drag-over']}
								role="tab"
								tabIndex={0}
								aria-selected={name === activeFile}
								draggable={true}
								onClick={() => controllerRef.current.selectFile?.(name)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										controllerRef.current.selectFile?.(name);
									}
								}}
								onDragStart={(e) => {
									draggingFileRef.current = name;
									e.dataTransfer!.effectAllowed = 'move';
									e.dataTransfer!.setData('text/plain', name);
								}}
								onDragOver={(e) => {
									e.preventDefault();
									setDragOverFile(name);
								}}
								onDragLeave={() => {
									if (dragOverFile === name) setDragOverFile(null);
								}}
								onDrop={(e) => {
									e.preventDefault();
									const from = draggingFileRef.current;
									draggingFileRef.current = null;
									setDragOverFile(null);
									if (from && from !== name) {
										controllerRef.current.moveFile?.(from, name);
									}
								}}
								onDragEnd={() => {
									draggingFileRef.current = null;
									setDragOverFile(null);
								}}
							>
								@if (name === entryFile) {
									<span class="pg-tab-dot" title="Entry file — the preview renders this module's default export" />
								}
								<span class="pg-tab-name">
									<span
										class={name === activeFile && name !== entryFile ? 'pg-tab-input-mask' : undefined}
									>
										{(name === activeFile && name !== entryFile ? inputValue : name) as string}
									</span>
									@if (name === activeFile && name !== entryFile) {
										<input
											ref={renameInputRef}
											class="pg-tab-input"
											value={inputValue}
											spellCheck={false}
											aria-label={'Rename ' + name}
											onInput={(e) => setInputValue(e.currentTarget.value)}
											onFocus={(e) => {
												const input = e.currentTarget;
												setTimeout(() => input.select());
											}}
											onBlur={() => {
												if (inputValue === name || inputValue === '') {
													setInputValue(name);
													return;
												}
												controllerRef.current.renameFile?.(name, inputValue);
											}}
											onKeyDown={(e) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													e.currentTarget.blur();
												} else if (e.key === 'Escape') {
													setInputValue(name);
													e.currentTarget.blur();
												}
											}}
										/>
									}
								</span>
								@if (name === activeFile && name !== entryFile) {
									<button
										type="button"
										class="pg-tab-close"
										aria-label={'Delete ' + name}
										title="Delete file"
										disabled={files.length <= 1}
										onClick={(e) => {
											e.stopPropagation();
											if (window.confirm('Delete ' + name + '?')) {
												controllerRef.current.removeFile?.(name);
											}
										}}
									>{'×'}</button>
								}
							</div>
						}
						<button
							type="button"
							class="pg-tab-add"
							aria-label="Add file"
							title={'Add a file (up to ' + MAX_PLAYGROUND_FILES + ')'}
							disabled={!ready || files.length >= MAX_PLAYGROUND_FILES}
							onClick={() => controllerRef.current.addFile?.()}
						>{'+'}</button>
					</div>
					@if (!ready) {
						<span class="pg-loading">Loading editor…</span>
					}
				</div>
				<div class="pg-editor" ref={sourceHostRef} />
			</section>

			<section class={['pg-panel', pane !== 'result' && 'mobile-hidden']} aria-label="Result">
				<div class="pg-panel-head">
					<span>
						{view === 'preview'
							? 'Live preview'
							: OUTPUT_TARGET_LABEL[outputTarget] +
								(compiledMode === 'ast' ? ' AST · ' : ' output · ') +
								(activeFile || '…')}
					</span>
					@if (view === 'compiled') {
						<div class="pg-compiled-controls">
							<select
								class="pg-select pg-output-select"
								aria-label="Compiler output"
								value={outputTarget}
								onChange={(event) => selectOutputTarget(
									event.currentTarget.value as PlaygroundOutputTarget,
								)}
							>
								<option value="client">Client</option>
								<option value="server">Server</option>
								<option value="types">Types</option>
							</select>
							<div class="pg-seg pg-seg-sm" role="group" aria-label="Output format">
								<button
									type="button"
									class={['pg-seg-btn', compiledMode === 'code' && 'active']}
									onClick={() => selectCompiledMode('code')}
								>
									Code
								</button>
								<button
									type="button"
									class={['pg-seg-btn', compiledMode === 'ast' && 'active']}
									onClick={() => selectCompiledMode('ast')}
								>
									AST
								</button>
							</div>
						</div>
					}
				</div>
				<div class={['pg-result', view !== 'preview' && 'hidden']}>
					<div class="pg-preview" ref={previewHostRef} />
					@if (gated) {
						<div class="pg-consent" role="alertdialog" aria-label="Run shared code?">
							<div class="pg-consent-card">
								<strong>This link contains shared code.</strong>
								<p>
									It was written by whoever sent you this link. Review it in the editor (and the
									compiled output) — it runs in a sandbox, but only after you choose to run it.
								</p>
								<button
									type="button"
									class="pg-consent-run"
									disabled={!ready}
									onClick={() => controllerRef.current.approveRun?.()}
								>
									Run code
								</button>
							</div>
						</div>
					}
				</div>
				<div class={['pg-compiled', view !== 'compiled' && 'hidden']}>
					<div class={['pg-ast-host', compiledMode !== 'ast' && 'hidden']} ref={astHostRef} />
					<div class={['pg-output', compiledMode !== 'code' && 'hidden']}>
						<div class="pg-editor" ref={outputHostRef} />
					</div>
				</div>
			</section>
		</div>

		<div class="pg-mobile-toggle" role="group" aria-label="Visible panel">
			<button
				type="button"
				class={['pg-seg-btn', pane === 'editor' && 'active']}
				onClick={() => {
					paneRef.current = 'editor';
					setPane('editor');
				}}
			>
				Code
			</button>
			<button
				type="button"
				class={['pg-seg-btn', pane === 'result' && view === 'preview' && 'active']}
				onClick={openMobilePreview}
			>
				Preview
			</button>
			<button
				type="button"
				class={['pg-seg-btn', pane === 'result' && view === 'compiled' && 'active']}
				title="Show the compiled output for the current file"
				onClick={openMobileCompiled}
			>
				Inspect
			</button>
		</div>

		<style>
			.pg {
				display: flex;
				flex-direction: column;
				position: relative;
				/* Fill the viewport below the sticky nav (60px + 1px border), edge to
				   edge — the layout renders no footer on this page, so nothing
				   scrolls. dvh tracks mobile browser chrome. */
				height: calc(100vh - 61px);
				height: calc(100dvh - 61px);
			}
			.pg-toolbar {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 1rem;
				flex-wrap: wrap;
				padding: 0.65rem 1rem;
			}
			.pg-toolbar-side {
				display: flex;
				align-items: center;
				gap: 0.75rem;
				flex-wrap: wrap;
			}
			.pg-select {
				font: inherit;
				font-size: 0.85rem;
				font-weight: 500;
				color: var(--text);
				/* Custom chevron (appearance: none drops the native one) so the
				   indicator gets breathing room from the right edge. */
				appearance: none;
				padding: 0.35rem 2.1rem 0.35rem 0.65rem;
				border-radius: 8px;
				border: 1px solid var(--border);
				background: var(--surface-subtle);
				background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2399a1b3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
				background-repeat: no-repeat;
				background-position: right 0.75rem center;
				cursor: pointer;
				max-width: 15rem;
			}
			.pg-select:disabled {
				opacity: 0.5;
				cursor: default;
			}
			.pg-select option,
			.pg-select optgroup {
				background: var(--panel);
				color: var(--text);
			}
			.pg-format {
				font: inherit;
				font-size: 0.85rem;
				font-weight: 500;
				color: var(--text-secondary);
				padding: 0.35rem 0.9rem;
				border-radius: 9999px;
				border: 1px solid var(--border);
				background: var(--surface-subtle);
				cursor: pointer;
			}
			.pg-format:hover:not(:disabled) {
				color: var(--text);
			}
			.pg-format:disabled {
				opacity: 0.5;
				cursor: default;
			}
			.pg-seg {
				display: inline-flex;
				padding: 3px;
				border-radius: 9999px;
				border: 1px solid var(--border);
				background: var(--surface-subtle);
			}
			/* Compact variant for the panel-head Code/AST switch. */
			.pg-seg-sm {
				padding: 2px;
			}
			.pg-seg-sm .pg-seg-btn {
				font-size: 0.68rem;
				padding: 0.12rem 0.6rem;
				letter-spacing: 0.06em;
			}
			.pg-compiled-controls {
				display: flex;
				align-items: center;
				gap: 0.45rem;
			}
			.pg-output-select {
				max-width: 9.5rem;
				padding: 0.18rem 1.7rem 0.18rem 0.55rem;
				background-position: right 0.55rem center;
				font-size: 0.68rem;
				letter-spacing: 0;
				text-transform: none;
			}
			.pg-seg-btn {
				border: none;
				background: transparent;
				color: var(--text-secondary);
				font: inherit;
				font-size: 0.85rem;
				font-weight: 500;
				padding: 0.3rem 0.9rem;
				border-radius: 9999px;
				cursor: pointer;
			}
			.pg-seg-btn:hover:not(:disabled) {
				color: var(--text);
			}
			.pg-seg-btn.active {
				color: var(--accent-text);
				background: rgba(255, 65, 90, 0.14);
			}
			.pg-seg-btn:disabled {
				opacity: 0.5;
				cursor: default;
			}
			.pg-error {
				padding: 0.6rem 1rem;
				border-top: 1px solid rgba(255, 93, 114, 0.4);
				background: rgba(255, 65, 90, 0.12);
				color: var(--danger-text);
				font-size: 0.85rem;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
				white-space: pre-wrap;
			}
			.pg-warning-location {
				color: var(--text-secondary);
			}
			.pg-grid {
				display: grid;
				grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
				flex: 1;
				min-height: 320px;
			}
			.pg-mobile-toggle {
				display: none;
			}
			.pg-panel {
				display: flex;
				flex-direction: column;
				min-width: 0;
				min-height: 0;
				border-top: 1px solid var(--border);
				overflow: hidden;
				background: var(--code-bg);
			}
			.pg-panel + .pg-panel {
				border-left: 1px solid var(--border);
			}
			.pg-panel-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 1rem;
				min-height: 2.7rem;
				padding: 0.45rem 0.9rem;
				border-bottom: 1px solid var(--border);
				background: var(--surface-subtle);
				color: var(--text-secondary);
				font-size: 0.72rem;
				letter-spacing: 0.08em;
				text-transform: uppercase;
			}
			.pg-tabs {
				display: flex;
				align-items: center;
				gap: 0.25rem;
				flex-wrap: wrap;
			}
			.pg-tab {
				position: relative;
				display: flex;
				align-items: center;
				gap: 0.15rem;
				/* Right padding reserves the close button's slot so active and
				   inactive tabs stay the same width. */
				padding: 0.15rem 1.6rem 0.15rem 0.5rem;
				border-radius: 6px;
				color: var(--text-secondary);
				cursor: pointer;
			}
			.pg-tab.drag-over {
				background: var(--surface);
				box-shadow: inset 0 0 0 1px var(--border-strong);
			}
			.pg-tab.active {
				color: var(--accent-text);
				background: rgba(255, 65, 90, 0.14);
			}
			.pg-tab-dot {
				flex: none;
				width: 5px;
				height: 5px;
				border-radius: 50%;
				background: var(--accent-text);
			}
			.pg-tab-name {
				position: relative;
				font-size: 0.78rem;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
				text-transform: none;
				letter-spacing: normal;
				padding: 0.05rem 0.1rem;
				border-radius: 4px;
			}
			/* While the overlay input is editing, the text below it is hidden
			   (kept in flow only to hold the tab's width). */
			.pg-tab-input-mask {
				visibility: hidden;
			}
			.pg-tab.active .pg-tab-name {
				cursor: text;
			}
			/* The active tab's name is a live input, invisible over the name
			   text below it — clicking the tab edits the name in place. */
			.pg-tab-input {
				position: absolute;
				inset: 0;
				width: 100%;
				margin: 0;
				border: none;
				outline: none;
				background: transparent;
				color: inherit;
				font: inherit;
				font-size: 0.78rem;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
				text-transform: none;
				letter-spacing: normal;
				/* Matches .pg-tab-name so the input text lines up with where
				   the masked text sits. */
				padding: 0.05rem 0.1rem;
				box-sizing: border-box;
				cursor: text;
			}
			.pg-tab-close {
				position: absolute;
				right: 0.15rem;
				top: 50%;
				transform: translateY(-50%);
				display: flex;
				align-items: center;
				justify-content: center;
				width: 1.3rem;
				height: 1.3rem;
				border: none;
				background: transparent;
				color: var(--text-secondary);
				font-size: 0.9rem;
				line-height: 1;
				padding: 0;
				border-radius: 4px;
				cursor: pointer;
				opacity: 0.65;
			}
			.pg-tab-close:hover:not(:disabled) {
				opacity: 1;
				color: var(--danger-text);
				background: rgba(255, 93, 114, 0.14);
			}
			.pg-tab-close:disabled {
				opacity: 0.2;
				cursor: default;
			}
			.pg-tab-add {
				border: none;
				background: transparent;
				color: var(--text-secondary);
				font: inherit;
				font-size: 0.95rem;
				line-height: 1;
				padding: 0.12rem 0.45rem;
				border-radius: 6px;
				cursor: pointer;
			}
			.pg-tab-add:hover:not(:disabled) {
				color: var(--accent-text);
				background: rgba(255, 65, 90, 0.12);
			}
			.pg-tab-add:disabled {
				opacity: 0.4;
				cursor: default;
			}
			.pg-loading {
				text-transform: none;
				letter-spacing: normal;
			}
			.pg-editor {
				flex: 1;
				min-height: 0;
			}
			.pg-editor.hidden,
			.pg-compiled.hidden,
			.pg-result.hidden {
				display: none;
			}
			.pg-compiled {
				display: flex;
				flex: 1;
				min-height: 0;
				flex-direction: column;
			}
			.pg-output {
				display: flex;
				flex: 1;
				min-height: 0;
				flex-direction: column;
			}
			.pg-output.hidden,
			.pg-ast-host.hidden {
				display: none;
			}
			.pg-ast-host {
				flex: 1;
				min-height: 0;
				overflow: hidden;
			}
			.pg-ast-host :global(.pg-ast-shell) {
				display: flex;
				height: 100%;
				min-height: 0;
				flex-direction: column;
				background: var(--code-bg);
				color: var(--text);
				font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
				font-size: 0.75rem;
			}
			.pg-ast-host :global(.pg-ast-status),
			.pg-ast-host :global(.pg-ast-notice) {
				padding: 0.18rem 0.45rem;
				border-bottom: 1px solid var(--border);
				color: var(--text-secondary);
				font-family: var(--font-sans, system-ui, sans-serif);
				font-size: 0.65rem;
			}
			.pg-ast-host :global(.pg-ast-status) {
				color: var(--text);
				font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
			}
			.pg-ast-host :global(.pg-ast-notice) {
				border-top: 1px solid var(--border);
				border-bottom: 0;
			}
			.pg-ast-host :global(.pg-ast-scroll) {
				flex: 1;
				min-height: 0;
				overflow: auto;
				padding: 0.35rem 0.45rem 0.65rem;
			}
			.pg-ast-host :global(.pg-ast-tree),
			.pg-ast-host :global(.pg-ast-node ul) {
				margin: 0;
				padding: 0;
				list-style: none;
			}
			.pg-ast-host :global(.pg-ast-node ul) {
				padding-left: 1rem;
			}
			.pg-ast-host :global(.pg-ast-node summary),
			.pg-ast-host :global(.pg-ast-value),
			.pg-ast-host :global(.pg-ast-closing) {
				display: block;
				width: max-content;
				padding: 0 0.1rem;
				border-radius: 2px;
				white-space: pre;
			}
			.pg-ast-host :global(.pg-ast-node summary) {
				cursor: pointer;
			}
			.pg-ast-host :global(.pg-ast-node[data-ast-path='true'] > details:not([open]) > summary),
			.pg-ast-host :global(.pg-ast-node[data-ast-leaf='true'] > details > summary) {
				background: rgba(255, 234, 0, 0.2);
				box-shadow: inset 0 0 0 1px rgba(214, 185, 0, 0.2);
			}
			.pg-ast-host :global(.pg-ast-node[data-ast-leaf='true'] > details > summary) {
				background: rgba(255, 234, 0, 0.34);
			}
			.pg-ast-host :global(.pg-ast-node[data-ast-pinned='true'] > details > summary) {
				box-shadow: inset 0 0 0 1px rgba(214, 185, 0, 0.55);
			}
			.pg-ast-host :global(.pg-ast-key) {
				color: var(--text);
				text-decoration: underline;
				text-decoration-color: var(--border-strong);
			}
			.pg-ast-host :global(.pg-ast-type) {
				color: var(--accent-text);
			}
			.pg-ast-host :global(.pg-ast-range),
			.pg-ast-host :global(.pg-ast-reference),
			.pg-ast-host :global(.pg-ast-undefined),
			.pg-ast-host :global(.pg-ast-null) {
				color: var(--text-secondary);
			}
			.pg-ast-host :global(.pg-ast-string) {
				color: var(--syntax-string, #a56a12);
			}
			.pg-ast-host :global(.pg-ast-number),
			.pg-ast-host :global(.pg-ast-boolean),
			.pg-ast-host :global(.pg-ast-bigint) {
				color: var(--syntax-number, #2f8f46);
			}
			.pg-grid:not(.ready) :global(.cm-editor) {
				opacity: 0;
			}
			.pg-editor :global(.cm-editor) {
				height: 100%;
			}
			/* Ranges revealed by source↔output position mapping. */
			.pg-editor :global(.cm-mapped) {
				background: rgba(255, 234, 0, 0.42);
				box-shadow: inset 0 0 0 1px rgba(214, 185, 0, 0.28);
				border-radius: 2px;
			}
			.pg-result {
				position: relative;
				display: flex;
				flex: 1;
				min-height: 0;
			}
			/* The preview is a sandboxed iframe (opaque origin) — the content's
			   background/padding live in its srcdoc, not here (the parent relays
			   theme flips over the sandbox protocol). */
			.pg-preview {
				flex: 1;
				min-height: 0;
				background: var(--code-bg);
			}
			.pg-consent {
				position: absolute;
				inset: 0;
				display: grid;
				place-items: center;
				padding: 1.25rem;
				background: var(--header-bg);
				backdrop-filter: blur(6px);
			}
			.pg-consent-card {
				max-width: 26rem;
				display: grid;
				gap: 0.6rem;
				justify-items: start;
				padding: 1.1rem 1.25rem;
				border-radius: 12px;
				border: 1px solid var(--border-strong);
				background: var(--panel);
				color: var(--text);
				font-size: 0.9rem;
			}
			.pg-consent-card p {
				margin: 0;
				color: var(--text-secondary);
			}
			.pg-consent-run {
				font: inherit;
				font-weight: 600;
				padding: 0.45rem 1.1rem;
				border-radius: 8px;
				border: 1px solid rgba(255, 93, 114, 0.5);
				background: rgba(255, 65, 90, 0.14);
				color: var(--accent-text);
				cursor: pointer;
			}
			.pg-consent-run:disabled {
				opacity: 0.5;
				cursor: default;
			}
			@media (max-width: 980px) {
				.pg-toolbar {
					display: block;
					padding: 0.45rem 0.6rem;
				}
				.pg-toolbar-side {
					display: grid;
					grid-template-columns: minmax(7rem, 1fr) auto auto;
					gap: 0.4rem;
					width: 100%;
				}
				.pg-toolbar-side .pg-select {
					width: 100%;
					min-width: 0;
				}
				.pg-toolbar-side .pg-seg {
					padding: 2px;
				}
				.pg-toolbar-side .pg-seg-btn,
				.pg-format {
					padding: 0.3rem 0.55rem;
				}
				.pg-view-switch {
					display: none;
				}
				/* One panel at a time — the bottom toggle switches editor ↔ result. */
				.pg-grid {
					grid-template-columns: 1fr;
				}
				.pg-panel.mobile-hidden {
					display: none;
				}
				.pg-panel + .pg-panel {
					border-left: none;
				}
				.pg-mobile-toggle {
					display: flex;
					position: absolute;
					z-index: 10;
					left: 50%;
					bottom: max(0.45rem, env(safe-area-inset-bottom));
					width: min(calc(100% - 1rem), 23rem);
					transform: translateX(-50%);
					gap: 0.25rem;
					padding: 3px;
					border-radius: 9999px;
					border: 1px solid var(--border);
					background: var(--header-bg-solid);
					backdrop-filter: blur(12px);
				}
				.pg-mobile-toggle .pg-seg-btn {
					flex: 1;
					min-width: 0;
					padding: 0.45rem 0.9rem;
				}
				.pg-editor :global(.cm-content),
				.pg-ast-host :global(.pg-ast-scroll) {
					padding-bottom: 4rem;
				}
				.pg-ast-host :global(.pg-ast-notice) {
					order: 1;
					border-top: 0;
					border-bottom: 1px solid var(--border);
				}
				.pg-ast-host :global(.pg-ast-scroll) {
					order: 2;
				}
				.pg-ast-host :global(.pg-ast-node summary) {
					padding-block: 0.12rem;
				}
			}
		</style>
	</div>
}
