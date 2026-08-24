// DarTsx syntax highlighting through the REAL TextMate grammars shipped with
// the language service (packages/language-service/syntaxes/) — the same
// injection grammar VS Code layers over TSX, so the editor sees DarTsx
// keywords (component/state/derived/render/bind) exactly like IDE users.
//
// <style> blocks are NOT handled by TextMate: the style injection embeds
// source.css via an external-grammar include, and inside an INJECTION context
// vscode-textmate never re-evaluates the enclosing end pattern once the
// external grammar starts matching — the CSS region swallows the rest of the
// document (verified empirically; top-level languages don't have this bug,
// injections do). Instead, buildDecorations extracts <style> regions, feeds
// them through the css grammar directly, and splices those tokens back in —
// correct termination and real CSS tokenization by construction.
//
// Architecture: CodeMirror has no DarTsx Lezer grammar, so instead of a
// language mode the editor re-tokenizes the whole document with Shiki on
// change and paints themed token colors as mark decorations. Highlighting is
// async (the highlighter loads lazily); a version counter drops stale
// results. themes.ts still owns editor chrome AND provides the
// syntaxHighlighting facet lsp-client needs for tooltip code fences — its
// token painting is superseded by these decorations (the
// `.cm-editor span.cm-shiki` specificity rule in index.html settles ties).
//
// Dual light/dark theme pair emitted as --shiki-light/--shiki-dark custom
// properties per token; the [data-theme] CSS in index.html picks the active
// one — no re-tokenize on theme flip.
//
// Client-only: pulls in the WASM-backed shiki bundle (loaded eagerly since
// the switch to static imports).
import {
	EditorView,
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import { type Extension, StateEffect, StateField } from '@codemirror/state';
import {
	createHighlighter,
	type Highlighter,
	type LanguageRegistration,
	type ThemedToken,
} from 'shiki';
import renderRaw from '@dartsx/language-service/syntaxes/dartsx.render.injection.tmLanguage.json?raw';

// The REAL VS Code Dark+ / Light+ TextMate themes (Shiki bundles them) — the
// exact color schemes VS Code ships, so every scope our grammars emit
// (keywords, storage types, entities, css internals…) gets its authentic
// VS Code color. No hand-maintained theme mapping.
const PLAYGROUND_SHIKI_THEMES = {
	light: 'light-plus',
	dark: 'dark-plus',
} as const;

/** Root scopes the DarTsx render injection layers over (Shiki matches base scopes only). */
const TSX_SCOPES = ['source.ts', 'source.tsx', 'source.js', 'source.jsx'];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: [PLAYGROUND_SHIKI_THEMES.light, PLAYGROUND_SHIKI_THEMES.dark],
			langs: [
				'tsx',
				'css',
				{
					...(JSON.parse(renderRaw) as LanguageRegistration),
					// Shiki's registry derives injections from `injectTo` (its
					// equivalent of VS Code's package.json "injectTo" contribution);
					// the grammar's own top-level `injectionSelector` (including its
					// -comment/-string exclusions) is honored during collection.
					injectTo: TSX_SCOPES,
				},
			],
		});
	}
	return highlighterPromise;
}

/** A `<style>` block's inner-CSS range in the authored document. */
interface StyleRegion {
	start: number;
	end: number;
}

/**
 * Extract `<style ...>...</style>` regions (mirrors the compiler's own
 * extraction semantics closely enough for coloring).
 */
function findStyleRegions(doc: string): StyleRegion[] {
	const regions: StyleRegion[] = [];
	const re = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/g;
	for (const match of doc.matchAll(re)) {
		const openEnd = match.index! + match[0]!.indexOf('>') + 1;
		regions.push({ start: openEnd, end: match.index! + match[0]!.length - '</style>'.length });
	}
	return regions;
}

const inRegions = (regions: StyleRegion[], from: number, to: number): boolean =>
	regions.some((r) => from < r.end && to > r.start);

// Re-highlighting allocates per TOKEN (thousands per document, every
// keystroke), but the number of distinct token styles is bounded by the
// theme palette (a few dozen pairs) — so mark decorations are interned by
// their style string and reused across tokens, documents, and re-highlights.
const tokenDecorations = new Map<string, Decoration>();

function tokenDecoration(style: Record<string, string>): Decoration {
	// With defaultColor: false the per-theme colors arrive as custom
	// properties in htmlStyle; the stylesheet maps them to `color`. The
	// serialized declaration doubles as the intern key.
	let styleText = '';
	for (const property in style) styleText += `${property}:${style[property]};`;
	let deco = tokenDecorations.get(styleText);
	if (!deco) {
		deco = Decoration.mark({ class: 'cm-shiki', attributes: { style: styleText } });
		tokenDecorations.set(styleText, deco);
	}
	return deco;
}

function collectTokens(
	tokens: ThemedToken[][],
	offsetShift: number,
	out: { from: number; to: number; deco: Decoration }[],
	docLength: number,
	skip?: (from: number, to: number) => boolean,
): void {
	for (const line of tokens) {
		for (const token of line) {
			const from = token.offset + offsetShift;
			const to = from + token.content.length;
			if (to > docLength) continue;
			if (skip?.(from, to)) continue;
			const style = token.htmlStyle;
			if (style) out.push({ from, to, deco: tokenDecoration(style) });
		}
	}
}

async function buildDecorations(
	doc: string,
	highlighter: Highlighter,
	lang: string,
): Promise<DecorationSet> {
	if (!doc) return Decoration.none;

	const styleRegions = lang === 'tsx' ? findStyleRegions(doc) : [];

	const ranges: { from: number; to: number; deco: Decoration }[] = [];
	try {
		// TSX side (with DarTsx keyword injections). Style-block interiors are
		// dropped here and replaced by dedicated css tokenization below — the
		// base TSX grammar would otherwise paint them as plain JS expressions.
		const tsxTokens = highlighter.codeToTokens(doc, {
			lang: lang as never,
			themes: PLAYGROUND_SHIKI_THEMES,
			defaultColor: false,
		}).tokens;
		collectTokens(tsxTokens, 0, ranges, doc.length, (from, to) =>
			inRegions(styleRegions, from, to),
		);

		// CSS side: each <style> block tokenized by the real css grammar,
		// shifted back into document coordinates.
		for (const region of styleRegions) {
			const cssText = doc.slice(region.start, region.end);
			const cssTokens = highlighter.codeToTokens(cssText, {
				lang: 'css',
				themes: PLAYGROUND_SHIKI_THEMES,
				defaultColor: false,
			}).tokens;
			collectTokens(cssTokens, region.start, ranges, doc.length);
		}
	} catch {
		return Decoration.none;
	}

	ranges.sort((a, b) => a.from - b.from || a.to - b.to);
	return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)));
}

const setDecorations = StateEffect.define<DecorationSet>();

/**
 * A CodeMirror extension that highlights the document with Shiki using the
 * given language (`'tsx'`). The language is fixed per extension instance —
 * swap it with a Compartment reconfigure.
 */
export function shikiHighlight(lang: string): Extension {
	const field = StateField.define<DecorationSet>({
		create() {
			return Decoration.none;
		},
		update(value, tr) {
			for (const effect of tr.effects) {
				if (effect.is(setDecorations)) return effect.value;
			}
			// Keep marks anchored while async re-highlight is in flight.
			return tr.docChanged ? value.map(tr.changes) : value;
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	const plugin = ViewPlugin.define((view) => {
		let disposed = false;
		let pendingVersion = 0;

		function highlight(v: EditorView) {
			const doc = v.state.doc.toString();
			const version = ++pendingVersion;
			getHighlighter()
				.then((h) => buildDecorations(doc, h, lang))
				.then((deco) => {
					if (!disposed && pendingVersion === version) {
						v.dispatch({ effects: setDecorations.of(deco) });
					}
				})
				.catch(() => {});
		}

		highlight(view);

		return {
			update(update: ViewUpdate) {
				if (update.docChanged) highlight(update.view);
			},
			destroy() {
				disposed = true;
			},
		};
	});

	return [field, plugin];
}
