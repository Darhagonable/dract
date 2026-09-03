/**
 * @dartsx/language-service — the DarTsx language core.
 *
 * Single source of truth for DarTsx language behavior: the Volar language
 * plugin (transform + source mappings + embedded CSS/HTML codes), hover
 * rewriting, diagnostic filtering, unused-CSS detection. Consumed by the
 * VS Code extension's language server and `dartsx check` from this root;
 * the tsserver plugin factory lives at ./plugin.
 *
 * The core is Node-free: every fs-touching function takes a required
 * readFile (fileName → content, undefined = degrade). Hosts wire it —
 * Node callers pass an fs-backed reader, browser workers pass one backed
 * by editor models or a virtual fs, plus an optional toSource for
 * generated→source offset mapping.
 */

export { getDarTsxLanguagePlugin, DarTsxVirtualCode } from './language';
export { getQuickInfoWithDarTsxKeywords } from './hover';
export {
	filterDarTsxDiagnostics,
	getUnusedCssDiagnostics,
	shouldSuppressDiagnostic,
	ALWAYS_SUPPRESS,
	ZONE_SUPPRESS,
} from './diagnostics';
export {
	analyzeUnusedCss,
	findStyleBlocks,
	collectUsedSelectors,
	extractRules,
	splitSelectors,
	isSelectorUnused,
	skipBracedExpression,
	DARTSX_UNUSED_CSS_CODE,
	type StyleBlock,
	type UsedSelectors,
	type CSSRule,
	type UnusedCssWarning,
} from './unused-css';
