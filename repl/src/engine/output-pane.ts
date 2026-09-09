// The compiled pane's presenter: derives per-file artifacts from the
// Compiler, tracks exactly which artifact (code or AST, per target) the pane
// is currently showing, and refreshes the read-only output view + AST
// inspector without disturbing marks that still describe what's on screen.
//
// It owns presentation state only — no compilation, no workspace mutation.
// The engine drives it from compile/sync paths; CodeMirror inspect extensions
// query it per cursor/hover event.
import type { EditorView } from '@codemirror/view';
import type { AstPreviewController } from '../features/ast-inspector/ast-preview.ts';
import { mappingFromSourceMap, type CodeMapping } from '../features/ast-inspector/mapping.ts';
import type { PlaygroundOutputTarget } from '../kernel/runtime/preview.ts';
import { isTsconfigFile } from '../kernel/types.ts';
import type { Compiler } from '../kernel/compiler.ts';
import type { ResultMode } from './create-engine.ts';

export const OUTPUT_TARGET_LABEL: Record<PlaygroundOutputTarget, string> = {
	client: 'Client',
	server: 'Server',
	types: 'Types',
};

export const AST_TARGET_META: Record<PlaygroundOutputTarget, { label: string; notice: string }> = {
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

// Server and Types are placeholders: DarTsx has no such emits yet. The
// targets stay so a future emit lands in the same pane; the placeholder text
// is deliberately a status line, not an error.
const SERVER_OUTPUT_NOTE =
	'// Server rendering is not available yet.\n' +
	'// DarTsx compiles one client runtime; a server emit is planned.';
const TYPES_OUTPUT_NOTE =
	'// Type declarations are not generated yet.\n' +
	'// DarTsx compiles TypeScript directly to JavaScript; a .d.ts emit is planned.';

interface CodeEntry {
	source: string;
	code: string;
	/** The compiled output's AST for the AST pane. */
	ast: unknown;
	/** The compile's source map (output → authored) for code mappings. */
	map: { mappings: string | unknown[][] } | null;
	/** Lazy per-target mapping (see buildMapping). */
	mapping?: CodeMapping | null;
	error: string | null;
}

export interface OutputPaneDeps {
	compiler: Compiler;
	mode: ResultMode;
	/** The document the read-only view booted with (staleness baseline). */
	initialOutputDoc: string;
	getActiveFile(): string;
	getSource(name: string): string;
	reportError(message: string): void;
	clearMapped(side: 'source' | 'output'): void;
	setOutputDoc(code: string): void;
	revealRanges(
		view: EditorView,
		ranges: { from: number; to: number }[],
		scroll: boolean,
	): void;
	views(): { source: EditorView; output: EditorView } | null;
	ast(): AstPreviewController | null;
}

export class OutputPane {
	private readonly runtimeCache = new Map<string, CodeEntry>();
	/** Track the last graph-level error so pane-only updates don't wipe it
	 * when per-file compilation succeeds. */
	private lastGraphError = '';
	// The exact string the output editor currently displays. The output view
	// is read-only and written ONLY through setOutputDoc, so this makes both
	// the refresh no-op check and activeMapping's staleness check a string
	// reference compare instead of an O(doc) toString per call.
	private lastShownOutput: string;
	// The entry + target that produced the current document — the mapping
	// owner for whatever the output editor displays, so per-cursor lookups
	// never re-derive which pipeline/target the pane is on.
	private lastShownEntry: { entry: CodeEntry; target: PlaygroundOutputTarget } | null = null;
	// The AST currently shown, with the source it was built from.
	private lastShownAst: { ast: unknown; source: string } | null = null;

	constructor(private readonly deps: OutputPaneDeps) {
		this.lastShownOutput = deps.initialOutputDoc;
	}

	setGraphError(error: string): void {
		this.lastGraphError = error;
	}

	/** The compile cache is keyed by file name — purge one (deletion/rename). */
	invalidateFile(name: string): void {
		this.runtimeCache.delete(name);
	}

	/** Example switches invalidate every cached artifact at once. */
	resetCache(): void {
		this.runtimeCache.clear();
		this.resetShown();
	}

	resetShown(): void {
		this.lastShownEntry = null;
		this.lastShownAst = null;
	}

	private runtimeEntry(name: string): CodeEntry {
		const source = this.deps.getSource(name);
		const cached = this.runtimeCache.get(name);
		if (cached && cached.source === source) return cached;
		let entry: CodeEntry;
		if (isTsconfigFile(name)) {
			// A config file has no compile step — its "compiled output"
			// is the file itself.
			entry = { source, code: source, ast: null, map: null, error: null };
		} else {
			const output = this.deps.compiler.outputFor(name);
			const error = this.deps.compiler.errorFor(name);
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
		this.runtimeCache.set(name, entry);
		return entry;
	}

	// Server/Types have no emit yet — the code pane shows a status line
	// and there is nothing to inspect. The AST pane gets an empty tree.
	private placeholderEntry(code: string): CodeEntry {
		return { source: '', code, ast: null, map: null, error: null };
	}

	/** Built once per (entry, target) and cached on the entry, so a mousemove
	 * stream costs one property read. */
	private buildMapping(entry: CodeEntry, target: PlaygroundOutputTarget): CodeMapping | null {
		if (target !== 'client' || !entry.map) return null;
		return mappingFromSourceMap(entry.source, entry.code, entry.map);
	}

	private activeMapping(): CodeMapping | null {
		const { mode } = this.deps;
		if (mode.view !== 'compiled' || mode.mode !== 'code') return null;
		const shown = this.lastShownEntry;
		if (
			!shown || shown.entry.source !== this.deps.getSource(this.deps.getActiveFile()) ||
			shown.entry.code !== this.lastShownOutput
		) return null;
		const mapping = this.buildMapping(shown.entry, shown.target);
		if (mapping) shown.entry.mapping = mapping;
		return mapping;
	}

	/** Per-cursor lookups only consult the visible cached artifact. The AST
	 * retains authored source offsets, so `source` is the staleness test. */
	activeAst(): { ast: unknown } | null {
		const { mode } = this.deps;
		if (mode.view !== 'compiled' || mode.mode !== 'ast') return null;
		return this.lastShownAst?.source === this.deps.getSource(this.deps.getActiveFile())
			? this.lastShownAst
			: null;
	}

	pairFor(side: 'source' | 'output', offset: number) {
		const mapping = this.activeMapping();
		if (!mapping) return null;
		return side === 'source'
			? mapping.pairFromSource(offset)
			: mapping.pairFromGenerated(offset);
	}

	clearPair(): void {
		this.deps.clearMapped('source');
		this.deps.clearMapped('output');
	}

	revealPair(
		pair: { source: { from: number; to: number }[]; output: { from: number; to: number }[] },
		scrollSide: 'source' | 'output' | null,
	): void {
		// Only a deliberate move — a click or a cursor placement — takes the
		// other pane somewhere. Hover marks in place and never steals scroll,
		// so a mapped range far from the hovered line is marked but stays
		// where it is until you click.
		const views = this.deps.views();
		if (!views) return;
		this.deps.revealRanges(views.source, pair.source, scrollSide === 'source');
		this.deps.revealRanges(views.output, pair.output, scrollSide === 'output');
	}

	revealAstRange(range: { from: number; to: number } | null, scroll: boolean): void {
		if (this.deps.mode.mode !== 'ast') return;
		if (!range || !this.activeAst()) {
			this.clearPair();
			return;
		}
		this.deps.clearMapped('output');
		const views = this.deps.views();
		if (views) this.deps.revealRanges(views.source, [range], scroll);
	}

	private astEntry(): { ast: unknown; source: string; label: string; notice: string; error: string | null } | null {
		const target = this.deps.mode.target;
		if (target === 'server' || target === 'types') return null;
		const meta = AST_TARGET_META[target];
		const entry = this.runtimeEntry(this.deps.getActiveFile());
		if (entry.error) return { ast: null, source: entry.source, label: meta.label, notice: meta.notice, error: entry.error };
		return {
			ast: entry.ast,
			source: entry.source,
			label: meta.label,
			notice: meta.notice,
			error: null,
		};
	}

	// The output document per target; server/types are placeholders with
	// no mapping at all.
	private targetEntry(target: PlaygroundOutputTarget): CodeEntry {
		switch (target) {
			case 'server':
				return this.placeholderEntry(SERVER_OUTPUT_NOTE);
			case 'types':
				return this.placeholderEntry(TYPES_OUTPUT_NOTE);
			default:
				return this.runtimeEntry(this.deps.getActiveFile());
		}
	}

	/**
	 * Refresh the compiled pane for the current (mode, active file). Returns
	 * the pane-level error, if any.
	 */
	showOutput(): string | null {
		const { mode, getActiveFile } = this.deps;
		// The compiled pane is not visible: skip entirely — no types
		// generation and no doc replacement. syncOutput re-runs this when
		// the pane is revealed, so it refreshes exactly once, on demand.
		if (mode.view !== 'compiled') return null;
		if (mode.mode === 'ast') {
			const target = mode.target;
			const meta = AST_TARGET_META[target];
			const entry = this.astEntry();
			const astPreview = this.deps.ast();
			if (!entry) {
				// Server/Types have no emit yet — nothing to inspect.
				this.clearPair();
				astPreview?.setUnavailable(meta.notice, getActiveFile());
				this.lastShownAst = null;
				return null;
			}
			if (entry.ast) {
				if (entry.ast !== this.lastShownAst?.ast) {
					this.clearPair();
					astPreview?.setAst(entry.ast, getActiveFile(), {
						label: entry.label,
						notice: entry.notice,
					});
					this.lastShownAst = { ast: entry.ast, source: entry.source };
				}
			} else {
				this.clearPair();
				const message =
					'AST generation failed. Fix the source to generate a new tree.';
				astPreview?.setUnavailable(message, getActiveFile());
				this.lastShownAst = null;
			}
			// Preserve a graph-level error when per-file inspection succeeds.
			this.deps.reportError(entry.error || this.lastGraphError);
			return entry.error;
		}
		const target = mode.target;
		const output = this.targetEntry(target);
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
		const sameArtifact = output === this.lastShownEntry?.entry && code === this.lastShownOutput;
		if (!sameArtifact) {
			this.clearPair();
			this.deps.ast()?.clear();
		}
		// Preserve a graph-level error when switching output artifacts.
		this.deps.reportError(output.error || this.lastGraphError);
		this.lastShownEntry = { entry: output, target };
		if (typeof code !== 'string' || code === this.lastShownOutput) return output.error;
		this.deps.setOutputDoc(code);
		this.lastShownOutput = code;
		// The output half of the pair changed — source marks were computed
		// against the previous artifact (the output field self-cleared via
		// its own doc change just now).
		this.deps.clearMapped('source');
		return output.error;
	}
}
