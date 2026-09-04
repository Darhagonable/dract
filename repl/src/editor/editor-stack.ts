// The CodeMirror editor stack: one writable source view whose per-file
// EditorState (undo history included) is kept across tab switches, plus the
// read-only compiled-output view. Owns editor chrome (line numbers, folding,
// keymap, theming through Compartments) and the source-budget guard.
//
// It deliberately knows nothing about compilation, the AST pane, or the
// TypeScript session: language/inspect extensions arrive as injected
// factories, and every interesting event (doc change, tab switch) flows back
// to the engine through narrow callbacks.
import { Compartment, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	keymap,
	lineNumbers,
} from '@codemirror/view';
import {
	codeFolding,
	foldGutter,
	syntaxHighlighting,
} from '@codemirror/language';
import {
	darkHighlightStyle,
	darkTheme,
	lightHighlightStyle,
	lightTheme,
} from './themes.ts';

/** The document the read-only output view boots with. */
export const OUTPUT_PLACEHOLDER = '// Compiled output appears here.';

export interface EditorStackDeps {
	sourceHost: HTMLElement;
	outputHost: HTMLElement;
	getSource(name: string): string;
	/**
	 * Budget guard for edits: return false to reject the transaction. The
	 * callee reports the limit error itself.
	 */
	acceptsEdit(newDocLength: number): boolean;
	onFormatShortcut(): void;
	onDocChange(nextDoc: string): void;
	/** Per-file language layer (highlighting, LSP plugin, linter). */
	languageExtensions(name: string): Extension[];
	/** Language layer of the read-only compiled-output view. */
	outputExtensions(): Extension[];
	/** Source↔output inspection layer (mapped marks, hover/navigate). */
	inspectExtensions(side: 'source' | 'output'): Extension[];
	/** Clear inspection marks on one side (both self-clear on doc changes). */
	clearInspection(side: 'source' | 'output'): void;
}

interface EditorEntry {
	state: EditorState;
	theme: Compartment;
}

// ── Editor theming, exactly solid-repl's architecture ─────────────────────
// themes.ts owns everything: per-theme editor chrome (darkTheme/lightTheme)
// plus the Lezer highlight styles (dark/lightHighlightStyle) that paint ALL
// editor tokens. The active pair is mounted through Compartments and
// reconfigured when the page's data-theme flips (applyTheme).
const isDark = (): boolean =>
	document.documentElement.getAttribute('data-theme') !== 'light';
const themeExtensions = (): Extension[] => [
	isDark() ? darkTheme : lightTheme,
	syntaxHighlighting(isDark() ? darkHighlightStyle : lightHighlightStyle, { fallback: true }),
];
// Typography from the pre-themes.ts editor (kept deliberately): the site's
// denser 0.85rem size, its mono stack, and roomier content padding. Mounted
// AFTER the theme compartment so it overrides themes.ts's scroller/content
// rules.
const editorTypography = EditorView.theme({
	'&': { fontSize: '0.85rem' },
	'.cm-scroller': {
		overflow: 'auto',
		fontFamily:
			'ui-monospace, SFMono-Regular, \'SF Mono\', Menlo, Consolas, \'Liberation Mono\', monospace',
	},
	'.cm-content': { padding: '1rem 0.25rem 1.25rem' },
});

const CHROME_EXTENSIONS: Extension[] = [
	lineNumbers(),
	foldGutter(),
	codeFolding(),
	drawSelection(),
	highlightActiveLine(),
	EditorView.lineWrapping,
	EditorState.tabSize.of(2),
];

export class EditorStack {
	private readonly entries = new Map<string, EditorEntry>();
	private current!: EditorEntry;
	private readonly outputTheme = new Compartment();
	readonly sourceView: EditorView;
	readonly outputView: EditorView;

	constructor(private readonly deps: EditorStackDeps, initialName: string) {
		this.current = this.makeEntry(initialName);
		this.sourceView = new EditorView({
			state: this.current.state,
			parent: deps.sourceHost,
		});
		this.outputView = new EditorView({
			state: EditorState.create({
				doc: OUTPUT_PLACEHOLDER,
				extensions: [
					...CHROME_EXTENSIONS,
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					// Solid-repl's output pane runs the same theme pair and the
					// TSX language so compiled output gets Lezer highlighting too.
					this.outputTheme.of(themeExtensions()),
					editorTypography,
					...deps.outputExtensions(),
					...deps.inspectExtensions('output'),
				],
			}),
			parent: deps.outputHost,
		});
	}

	/** Re-theme both views after the page's data-theme attribute flips. */
	applyTheme(): void {
		const ext = [
			isDark() ? darkTheme : lightTheme,
			syntaxHighlighting(isDark() ? darkHighlightStyle : lightHighlightStyle, { fallback: true }),
		];
		this.sourceView?.dispatch({ effects: this.current.theme.reconfigure(ext) });
		this.outputView?.dispatch({ effects: this.outputTheme.reconfigure(ext) });
	}

	replaceDoc(target: EditorView, doc: string): void {
		target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: doc } });
	}

	setOutputDoc(doc: string): void {
		this.replaceDoc(this.outputView, doc);
	}

	clearMapped(side: 'source' | 'output'): void {
		this.deps.clearInspection(side);
	}

	/**
	 * Tab switch: archive the previous file's state (undo history included),
	 * restore or create the new file's, and re-theme the restored state — it
	 * may have been created under the other page theme. A restored state may
	 * carry marks from an old pair — clear both sides along with it.
	 */
	open(name: string, previousName: string): void {
		if (previousName) this.entries.set(previousName, this.current);
		this.current = this.entries.get(name) ?? this.makeEntry(name);
		this.sourceView.setState(this.current.state);
		this.sourceView.dispatch({ effects: this.current.theme.reconfigure(themeExtensions()) });
		this.deps.clearInspection('source');
		this.deps.clearInspection('output');
	}

	/**
	 * Structural changes (example switch, file deletion) put a different
	 * document under the same view without a tab switch. With
	 * `reuseSavedState`, an archived state survives (deletion falling to the
	 * neighbor tab); otherwise a fresh one is built (example switch).
	 */
	reopen(name: string, reuseSavedState: boolean): void {
		this.current = (reuseSavedState && this.entries.get(name)) || this.makeEntry(name);
		this.sourceView.setState(this.current.state);
		if (reuseSavedState) {
			// setState fires no transaction: the old file's marks are stale.
			this.sourceView.dispatch({ effects: this.current.theme.reconfigure(themeExtensions()) });
		}
		this.deps.clearInspection('source');
	}

	forgetSavedStates(): void {
		this.entries.clear();
	}

	/** A file rename takes its archived undo history along to the new key. */
	renameSavedState(oldName: string, newName: string): void {
		const saved = this.entries.get(oldName);
		if (!saved) return;
		this.entries.delete(oldName);
		this.entries.set(newName, saved);
	}

	/** Deletion drops the file's undo history along with the file itself. */
	dropSavedState(name: string): void {
		this.entries.delete(name);
	}

	destroy(): void {
		this.sourceView.destroy();
		this.outputView.destroy();
	}

	private makeEntry(name: string): EditorEntry {
		const theme = new Compartment();
		return {
			theme,
			state: EditorState.create({
				doc: this.deps.getSource(name),
				extensions: [
					EditorState.changeFilter.of((transaction: Transaction) => {
						if (!transaction.docChanged) return true;
						return this.deps.acceptsEdit(transaction.newDoc.length);
					}),
					...CHROME_EXTENSIONS,
					history(),
					keymap.of([
						{
							key: 'Mod-Shift-f',
							run: () => {
								this.deps.onFormatShortcut();
								return true;
							},
						},
						...defaultKeymap,
						...historyKeymap,
						indentWithTab,
					]),
					// Solid-repl parity: themes.ts paints ALL tokens through the
					// Lezer highlight style; lsp-client also reads that facet when
					// rendering code fences inside hover/completion tooltips.
					theme.of(themeExtensions()),
					editorTypography,
					...this.deps.languageExtensions(name),
					...this.deps.inspectExtensions('source'),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return;
						this.deps.onDocChange(update.state.doc.toString());
					}),
				],
			}),
		};
	}
}
