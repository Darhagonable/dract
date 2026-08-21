/**
 * @dartsx/language — shared DarTsx language logic.
 *
 * Single source of truth for the DarTsx language: the Volar language
 * plugin (transform + mappings + embedded codes), hover rewrites,
 * diagnostic filtering, unused-CSS detection, and the canonical
 * TextMate grammars (syntaxes/).
 *
 * Package is free of Node runtime imports — file reads are injected
 * via ReadFileSync so it can run in tsserver, the language server,
 * the CLI, and the browser (Monaco worker).
 */

export { getDarTsxLanguagePlugin, type ReadFileSync } from './language';
export { getQuickInfoWithDarTsxKeywords } from './hover';
export {
	filterDarTsxDiagnostics,
	getUnusedCssDiagnostics,
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
export { isDarTsxFile } from 'dartsx/compiler/preprocess';