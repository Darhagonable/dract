// Source ↔ output position mapping marks (pure CodeMirror machinery).
// Placing the cursor in one editor highlights and reveals the mapped ranges
// in the other (see features/ast-inspector for the mapping semantics).
//
// Marks are only valid for the exact (source doc, output doc) PAIR they were
// computed against, so a change to either side must clear BOTH editors: each
// field self-clears on its own doc change, and clearMappedIn handles the
// cross-editor half (a source edit leaves output marks orphaned — visibly so
// when a broken edit means no recompile ever replaces the output doc — and
// setState doc swaps produce no transaction at all).
import {
	Decoration,
	EditorView,
	type DecorationSet,
} from '@codemirror/view';
import { StateEffect, StateField, type Transaction } from '@codemirror/state';

/** A generated name immediately preceded by one of these is its declaration
 * rather than a reference to it — the preferred target when navigating. */
const DECLARATION_BEFORE = /\b(?:function|const|let|var|class)\s+$/;

export const setMapped = StateEffect.define<DecorationSet>();
const mappedMark = Decoration.mark({ class: 'cm-mapped' });

/** Add to both the source and output editor states. */
export const mappedField = StateField.define<DecorationSet>({
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
export function clearMappedIn(targetView: EditorView): void {
	if (targetView.state.field(mappedField, false)?.size) {
		targetView.dispatch({ effects: setMapped.of(Decoration.none) });
	}
}

/** Does the view already show exactly `ranges` (sorted, as the mapping and
 * AST paths produce them)? */
function sameMarks(targetView: EditorView, ranges: { from: number; to: number }[]): boolean {
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
}

/** Mark `ranges` in `targetView`, optionally scrolling to the best range. */
export function revealRanges(
	targetView: EditorView,
	ranges: { from: number; to: number }[],
	scroll: boolean,
): void {
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
	// A pointer stream re-resolves the SAME ranges for most of its samples.
	// The field is the single source of truth (it self-clears on any doc
	// change), so comparing against it is always safe and costs one pass over
	// the handful of ranges shown.
	if (!scroll && sameMarks(targetView, clamped)) return;
	const marks = setMapped.of(
		Decoration.set(
			clamped.map((range) => mappedMark.range(range.from, range.to)),
		),
	);
	// Jump to the DEFINITION when one of the mapped ranges is a declared
	// name: a directive arm maps both to `function __case$0(…)` and to where
	// that name is handed to the runtime, and the implementation is what you
	// want to read. Every range still gets a mark either way.
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
}
