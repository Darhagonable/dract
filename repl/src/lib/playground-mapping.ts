// Source ↔ generated position mapping for the playground's code pane.
//
// DarTsx compiles to a different program than the source, so the code pane
// maps through the compiler's own source map — the final remapped artifact
// (output positions → authored positions) — rather than through AST spans,
// which only make sense inside the single document they index.
//
// A source-map segment is a POINT (output column ↔ source line/column), not a
// span, so this module synthesizes spans and answers queries over them:
//
//   - each segment's generated span runs to the next segment on its line (the
//     line end for the last one), and its authored span runs to the next
//     segment's source position when that stays in the same file and moves
//     forward — otherwise it widens to the end of the authored line, the
//     "authored end a standard source map cannot carry" the segments get;
//   - the compiler's printer records a segment pair per node it prints, so
//     nodes it could not attribute (synthesized lowerings, rewritten JSX)
//     produce no segments of their own and their output text falls inside a
//     neighbouring segment's span.
//
// Queries select the narrowest range containing the hovered/cursor offset.
// A match returns EVERY range mapped from the selected source range because
// one expression can appear in several output locations.
//
// Forwards (source→generated) only pairs that are true by construction
// answer: a generated token whose text REPRODUCES the authored text, or a
// range the verbatim passes verified as a unique exact text match. Everything
// else answers only backwards, so a highlight, when shown, is always right.
//
// Pure string/offset math — no CodeMirror or DOM imports, so tests can run
// it directly and the editor wiring stays in the page component.

import { decode } from '@jridgewell/sourcemap-codec';

export interface MappedRange {
	from: number;
	to: number;
}

export interface MappedPair {
	source: MappedRange[];
	output: MappedRange[];
}

export interface CodeMapping {
	/** Source and output ranges selected by one source-side lookup. */
	pairFromSource(offset: number): MappedPair | null;
	/** Source and output ranges selected by one generated-side lookup. */
	pairFromGenerated(offset: number): MappedPair | null;
}

interface Segment {
	src: number;
	gen: number;
	srcLen: number;
	genLen: number;
	/**
	 * Is this pair an EXACT correspondence (a verified text match or a
	 * compiler-asserted one), rather than an attribution inferred from a
	 * source-map position? See `createMapping`.
	 */
	exact: boolean;
}

/**
 * Segments that do NOT strictly contain another segment's authored range, plus
 * those that reproduce their authored text. See the forward-index rule.
 */
function notContainingAnother(
	segments: Segment[],
	reproduces: (segment: Segment) => boolean,
): Set<Segment> {
	const bySrc = [...segments].sort((a, b) => a.src - b.src);
	const keep = new Set<Segment>();
	for (let i = 0; i < bySrc.length; i++) {
		const segment = bySrc[i];
		if (reproduces(segment)) {
			keep.add(segment);
			continue;
		}
		const end = segment.src + segment.srcLen;
		let contains = false;
		// Sorted by src, so anything strictly inside starts at or after this one.
		for (let j = i; j < bySrc.length && bySrc[j].src < end; j++) {
			const other = bySrc[j];
			const otherEnd = other.src + other.srcLen;
			if (otherEnd <= end && (other.src > segment.src || otherEnd < end)) {
				contains = true;
				break;
			}
		}
		if (!contains) keep.add(segment);
	}
	return keep;
}

/** Both documents, when the caller has them — see the forward-index rule below. */
interface MappingTexts {
	source: string;
	generated: string;
}

/**
 * The two directions are not symmetric, because the artifacts are not.
 *
 * Backwards (generated→source) every segment is usable: a generated position
 * has one origin, and even a wide one ("somewhere in this line") is an
 * honest answer.
 *
 * Forwards it is not. A fat segment's authored range is resolved as "the
 * smallest node STARTING at this source offset", so a generated token the
 * printer could attribute no more precisely than to its enclosing declaration
 * comes back carrying that WHOLE declaration's range. Answering from those
 * would light up everything the declaration emitted — `const`, the parameter
 * list, the hoisted stylesheet a `<style>` block became — for a hover anywhere
 * inside it. Worse, a region with NO finer data inside it looks
 * indistinguishable from a real mapping, so no size or containment heuristic
 * separates them.
 *
 * So the forward index takes only pairs that are true by construction:
 *
 *   - `exact` segments — verified text matches from the verbatim passes, each
 *     a correspondence asserted rather than inferred;
 *   - fat segments whose generated text REPRODUCES the authored text, which is
 *     verifiable here and is what an identifier, a literal or a preserved
 *     expression looks like.
 *
 * Everything else answers only backwards. The cost is silence where the
 * compiler has no origin data (synthesized lowerings); the benefit is that a
 * highlight, when shown, is always right.
 */
function createMapping(
	segments: Segment[],
	texts: MappingTexts | null,
	reprint = false,
): CodeMapping | null {
	if (segments.length === 0) return null;
	const reproduces = (segment: Segment): boolean =>
		segment.srcLen === segment.genLen &&
		(texts === null ||
			texts.source.slice(segment.src, segment.src + segment.srcLen) ===
				texts.generated.slice(segment.gen, segment.gen + segment.genLen));
	// Which segments may answer a source→generated lookup?
	//
	// A compiled EMIT is a different program from the source, so a segment the
	// printer could not place precisely carries its whole enclosing
	// declaration, and answering from those scatters marks across unrelated
	// tokens. Only pairs true by construction qualify: compiler-asserted ones
	// (the verbatim passes), or ones whose generated text reproduces the
	// authored text.
	//
	// A REPRINT is the same program printed again, so a segment's authored end
	// is a real node range and its generated span is that node's own image even
	// when the two differ in length. Those must answer, or attribute values
	// stop resolving. The one thing that still cannot is a segment covering a
	// whole CONSTRUCT, which would otherwise win at every position no finer
	// segment covers and highlight the entire component. A segment containing
	// another's source range is exactly that, unless it reproduces its authored
	// text (a preserved expression, which legitimately answers for the
	// punctuation inside it).
	const leafOrReproducing = reprint ? notContainingAnother(segments, reproduces) : null;
	const bySrc = segments
		.filter((segment) =>
			leafOrReproducing === null
				? segment.exact || reproduces(segment)
				: segment.exact || leafOrReproducing.has(segment),
		)
		.sort((a, b) => a.src - b.src || a.gen - b.gen);
	const byGen = [...segments].sort((a, b) => a.gen - b.gen || a.src - b.src);

	const prefixEnds = (list: Segment[], key: 'src' | 'gen'): number[] => {
		const result: number[] = [];
		let maximum = -1;
		for (const segment of list) {
			const length = key === 'src' ? segment.srcLen : segment.genLen;
			maximum = Math.max(maximum, segment[key] + length);
			result.push(maximum);
		}
		return result;
	};
	const srcPrefixEnds = prefixEnds(bySrc, 'src');
	const genPrefixEnds = prefixEnds(byGen, 'gen');

	// Find every range containing the offset, then select the narrowest one.
	// Prefix maxima stop the backwards scan when no earlier range can overlap.
	// At a shared boundary prefer a range STARTING at the cursor; otherwise a
	// cursor parked just after a token still belongs to that token.
	const containing = (
		list: Segment[],
		ends: number[],
		key: 'src' | 'gen',
		offset: number,
	): Segment[] | null => {
		if (!Number.isSafeInteger(offset) || offset < 0) return null;
		let lo = 0;
		let hi = list.length - 1;
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid][key] <= offset) {
				found = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (found < 0) return null;

		const candidates: Segment[] = [];
		for (let i = found; i >= 0 && ends[i] >= offset; i--) {
			const segment = list[i];
			const length = key === 'src' ? segment.srcLen : segment.genLen;
			if (offset <= segment[key] + length) candidates.push(segment);
		}
		if (candidates.length === 0) return null;

		const startsHere = candidates.some((segment) => segment[key] === offset);
		let selected: Segment | null = null;
		let selectedLength = Infinity;
		for (const segment of candidates) {
			if (startsHere && segment[key] !== offset) continue;
			const length = key === 'src' ? segment.srcLen : segment.genLen;
			if (length < selectedLength) {
				selected = segment;
				selectedLength = length;
			}
		}
		if (!selected) return null;
		const selectedStart = selected[key];
		return candidates.filter((segment) => {
			const length = key === 'src' ? segment.srcLen : segment.genLen;
			return segment[key] === selectedStart && length === selectedLength;
		});
	};

	const ranges = (matched: Segment[], side: 'src' | 'gen'): MappedRange[] | null => {
		const seen = new Set<string>();
		const result: MappedRange[] = [];
		for (const segment of matched) {
			const start = side === 'gen' ? segment.gen : segment.src;
			const length = side === 'gen' ? segment.genLen : segment.srcLen;
			const range = { from: start, to: start + length };
			if (range.to <= range.from) continue;
			const key = range.from + ':' + range.to;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(range);
		}
		result.sort((a, b) => a.from - b.from || a.to - b.to);
		return result.length > 0 ? result : null;
	};
	const pair = (matched: Segment[] | null, forward: boolean): MappedPair | null => {
		if (!matched) return null;
		const source = ranges(matched, 'src');
		const output = ranges(matched, 'gen');
		if (!source || !output) return null;
		// One authored range legitimately emits a handful of times — an open and
		// a close tag, a mount and an update binding. A larger set is a
		// module-level attribution the printer could place no better, and
		// lighting all of it up communicates nothing. Backwards is never capped:
		// a generated position has exactly one origin.
		if (forward && output.length > FORWARD_RANGE_LIMIT) return null;
		return { source, output };
	};

	return {
		pairFromSource(offset) {
			return pair(containing(bySrc, srcPrefixEnds, 'src', offset), true);
		},
		pairFromGenerated(offset) {
			return pair(containing(byGen, genPrefixEnds, 'gen', offset), false);
		},
	};
}

const FORWARD_RANGE_LIMIT = 8;

const WHITESPACE = /\s/;

/** Line-start offsets of a document — binary-searchable for line/column math. */
function lineStartsOf(doc: string): number[] {
	const starts = [0];
	for (let i = 0; i < doc.length; i++) {
		if (doc.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return starts;
}

/**
 * Build a mapping from the source map a compile emitted — output positions
 * mapped all the way back to the authored `source` (not an intermediate
 * preprocessed document).
 *
 * `verbatim` may carry the authored source's OWN AST ranges (see
 * `playground-ast.ts` `collectAuthoredRanges`): synthesized lowerings and
 * rewritten JSX produce no map segments of their own, and their output text
 * lands inside a neighbour segment's span, so the segment pairs alone would
 * leave identifiers, literals and JSX text unmapped in the forward direction.
 * The verbatim passes rescue them by verified text matches — a range inside a
 * segment's authored span whose text appears once in that segment's generated
 * span, or (globally) exactly once in the whole document. A wrong highlight is
 * never invented: only unique, in-window matches qualify.
 */
export function mappingFromSourceMap(
	source: string,
	generated: string,
	map: { mappings?: string | unknown[][] } | null | undefined,
	verbatim?: { ranges: readonly MappedRange[] } | null,
): CodeMapping | null {
	if (!map || typeof map.mappings !== 'string' || map.mappings.length === 0) return null;
	let decoded: ReturnType<typeof decode>;
	try {
		decoded = decode(map.mappings);
	} catch {
		return null;
	}
	const srcStarts = lineStartsOf(source);
	const genStarts = lineStartsOf(generated);
	const segments: Segment[] = [];
	for (let line = 0; line < decoded.length; line++) {
		const segs = decoded[line];
		if (segs.length === 0) continue;
		const genLineStart = genStarts[line];
		if (genLineStart === undefined) continue;
		const genLineEnd = line + 1 < genStarts.length ? genStarts[line + 1] : generated.length;
		for (let i = 0; i < segs.length; i++) {
			const seg = segs[i];
			// [genCol, srcIdx, srcLine, srcCol] — only the authored file maps.
			const srcIdx = seg[1];
			const srcLine = seg[2];
			const srcCol = seg[3];
			if (srcIdx === undefined || srcLine === undefined || srcCol === undefined) continue;
			if (srcIdx !== 0) continue;
			const srcStart = srcStarts[srcLine] + srcCol;
			if (!Number.isSafeInteger(srcStart)) continue;
			const genFrom = genLineStart + seg[0];
			if (genFrom >= genLineEnd) continue;
			const genTo = i + 1 < segs.length ? genLineStart + segs[i + 1][0] : genLineEnd;
			// Authored span: to the next segment's source position when it stays
			// in the authored file and moves forward, else widen to the line end —
			// the authored end a source map cannot carry.
			let srcTo = -1;
			const next = segs[i + 1];
			if (next && next.length >= 4 && next[1] === 0) {
				const nextLine = next[2];
				const nextCol = next[3];
				if (nextLine !== undefined && nextCol !== undefined) {
					const nextPos = srcStarts[nextLine] + nextCol;
					if (nextPos > srcStart) srcTo = nextPos;
				}
			}
			if (srcTo <= srcStart) {
				const lineEnd = srcStarts[srcLine + 1] ?? source.length;
				if (lineEnd > srcStart) srcTo = lineEnd;
			}
			if (srcTo <= srcStart) continue;
			let genEnd = Math.min(genTo, generated.length);
			while (genEnd > genFrom && WHITESPACE.test(generated[genEnd - 1])) genEnd--;
			if (genEnd <= genFrom) continue;
			segments.push({
				src: srcStart,
				gen: genFrom,
				srcLen: srcTo - srcStart,
				genLen: genEnd - genFrom,
				exact: false,
			});
		}
	}
	if (segments.length === 0) return null;
	if (verbatim && verbatim.ranges.length > 0) {
		appendWindowedVerbatimSegments(segments, source, generated, verbatim.ranges);
		appendUniqueVerbatimSegments(segments, source, generated, verbatim.ranges);
	}
	return createMapping(segments, { source, generated }, false);
}

/**
 * Rescue authored ranges inside a segment's authored span: a range whose text
 * appears exactly once inside that segment's GENERATED span (which is the
 * printed text the printer attributed to the span) is a verified
 * correspondence, so it may answer source→generated lookups.
 *
 * `segments` is the freshly built list — this mutates it, and the spans are
 * scanned in order so each range is claimed by the FIRST segment whose
 * authored span contains it.
 */
function appendWindowedVerbatimSegments(
	segments: Segment[],
	source: string,
	generated: string,
	ranges: readonly MappedRange[],
): void {
	const byFrom = [...ranges]
		.filter((range: MappedRange) => range.to > range.from)
		.sort((a: MappedRange, b: MappedRange) => a.from - b.from || a.to - b.to);
	const mapped = new Set<string>();
	for (const segment of segments) mapped.add(segment.src + ':' + segment.srcLen);

	for (const segment of segments) {
		const srcEnd = segment.src + segment.srcLen;
		const genEnd = segment.gen + segment.genLen;
		let lo = 0;
		let hi = byFrom.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (byFrom[mid].from < segment.src) lo = mid + 1;
			else hi = mid;
		}
		for (let i = lo; i < byFrom.length && byFrom[i].from < srcEnd; i++) {
			const range = byFrom[i];
			if (range.to > srcEnd) continue;
			const key = range.from + ':' + (range.to - range.from);
			if (mapped.has(key)) continue;
			let from = range.from;
			let to = Math.min(range.to, source.length);
			// Whitespace-insensitive at the edges: a JSX text run's range
			// includes the newline and indentation around it.
			while (from < to && WHITESPACE.test(source[from])) from++;
			while (to > from && WHITESPACE.test(source[to - 1])) to--;
			if (to <= from) continue;
			const content = source.slice(from, to);
			let at = generated.indexOf(content, segment.gen);
			if (at < 0 || at + content.length > genEnd) continue;
			const again = generated.indexOf(content, at + 1);
			if (again >= 0 && again + content.length <= genEnd) continue; // ambiguous
			mapped.add(key);
			segments.push({
				src: from,
				gen: at,
				srcLen: to - from,
				genLen: content.length,
				exact: true,
			});
		}
	}
}

/**
 * Rescue authored ranges NO segment covers — rewritten JSX text, attribute
 * names, whole exports — when their text appears EXACTLY ONCE in the whole
 * generated document. Uniqueness is the verification: a repeated token cannot
 * be placed, and one that appears once is, by construction, the generated
 * image of this authored range.
 */
function appendUniqueVerbatimSegments(
	segments: Segment[],
	source: string,
	generated: string,
	ranges: readonly MappedRange[],
): void {
	const mapped = new Set<string>();
	for (const segment of segments) mapped.add(segment.src + ':' + segment.srcLen);
	for (const range of ranges) {
		if (range.to <= range.from || range.to - range.from > 256) continue;
		const key = range.from + ':' + (range.to - range.from);
		if (mapped.has(key)) continue;
		let from = range.from;
		let to = Math.min(range.to, source.length);
		while (from < to && WHITESPACE.test(source[from])) from++;
		while (to > from && WHITESPACE.test(source[to - 1])) to--;
		if (to <= from) continue;
		const content = source.slice(from, to);
		const at = generated.indexOf(content);
		if (at < 0) continue;
		if (generated.indexOf(content, at + 1) >= 0) continue; // ambiguous
		mapped.add(key);
		segments.push({
			src: from,
			gen: at,
			srcLen: to - from,
			genLen: content.length,
			exact: true,
		});
	}
}

/** React-host TSX is already the compiled document, so its mapping is identity. */
export function identityMapping(length: number): CodeMapping | null {
	if (!Number.isSafeInteger(length) || length <= 0) return null;
	const pair = (offset: number): MappedPair | null => {
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) return null;
		const from = Math.min(offset, length - 1);
		const range = { from, to: from + 1 };
		return { source: [range], output: [range] };
	};
	return { pairFromSource: pair, pairFromGenerated: pair };
}
