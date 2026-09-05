// Syntax highlighting and themes: Shiki (vscode-textmate engine) on top of
// monaco-editor-core, which ships without any language.
//
// DarTsx highlighting rides the TS/TSX grammars via our injection grammars
// (the same files the VS Code extension ships — imported from
// @dartsx/language-service so the two cannot drift). Standalone injection
// grammars (top-level `injectionSelector`) are only applied by an extension
// host, which does not exist here; a grammar's own `injections` map needs no
// host — so each injection grammar is merged into the TS and TSX roots: its
// repository rules are prefixed into the base grammar's repository and its
// patterns become the rule for its selector.

import * as monaco from 'monaco-editor-core';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine-javascript.mjs';
import { shikiToMonaco } from '@shikijs/monaco';
import langCss from 'shiki/langs/css.mjs';
import langJson from 'shiki/langs/json.mjs';
import langTs from 'shiki/langs/typescript.mjs';
import langTsx from 'shiki/langs/tsx.mjs';
import themeDarkPlus from 'shiki/themes/dark-plus.mjs';
import themeLightPlus from 'shiki/themes/light-plus.mjs';
import cssExpressionsGrammar from '@dartsx/language-service/syntaxes/dartsx.css-expressions.injection.tmLanguage.json';
import renderGrammar from '@dartsx/language-service/syntaxes/dartsx.render.injection.tmLanguage.json';
import styleGrammar from '@dartsx/language-service/syntaxes/dartsx.style.injection.tmLanguage.json';

const INJECTIONS = [renderGrammar, styleGrammar, cssExpressionsGrammar] as Array<{
	injectionSelector: string;
	patterns: unknown[];
	repository?: Record<string, unknown>;
}>;

function rewriteIncludes(node: unknown, prefix: string): unknown {
	if (Array.isArray(node)) return node.map((item) => rewriteIncludes(item, prefix));
	if (node && typeof node === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			out[key] =
				key === 'include' && typeof value === 'string' && value.startsWith('#')
					? `#${prefix}${value.slice(1)}`
					: rewriteIncludes(value, prefix);
		}
		return out;
	}
	return node;
}

function mergeInjections(grammar: unknown, prefix: string): Record<string, unknown> {
	const merged = structuredClone(grammar) as Record<string, unknown>;
	merged.repository = { ...((merged.repository as object) ?? {}) };
	merged.injections = { ...((merged.injections as object) ?? {}) };
	INJECTIONS.forEach((injection, index) => {
		const rulePrefix = `${prefix}dartsx${index}-`;
		for (const [key, rule] of Object.entries(injection.repository ?? {})) {
			(merged.repository as Record<string, unknown>)[rulePrefix + key] = rule;
		}
		(merged.injections as Record<string, unknown>)[injection.injectionSelector] = {
			patterns: rewriteIncludes(injection.patterns, rulePrefix),
		};
	});
	return merged;
}

// Shiki resolves a language by its registration `name`; align it with the
// monaco language id our models use (typescriptreact for .tsx).
const grammars = [
	...langTsx.map((entry) =>
		entry.scopeName === 'source.tsx'
			? { ...mergeInjections(entry, 'tsx-'), name: 'typescriptreact', aliases: ['tsx'] }
			: entry,
	),
	...langTs.map((entry) =>
		entry.scopeName === 'source.ts' ? mergeInjections(entry, 'ts-') : entry,
	),
	...langJson,
	...langCss,
];

// Languages must exist in monaco BEFORE shikiToMonaco runs: it snapshots
// monaco.languages.getLanguages() and only wires tokens providers for ids
// present at that moment — and monaco-editor-core ships with none.
monaco.languages.register({ id: 'typescript', extensions: ['.ts'] });
monaco.languages.register({ id: 'typescriptreact', extensions: ['.tsx'] });
monaco.languages.register({ id: 'javascript', extensions: ['.js'] });
monaco.languages.register({ id: 'json', extensions: ['.json'] });
monaco.languages.register({ id: 'css', extensions: ['.css'] });

const highlighter = createHighlighterCoreSync({
	langs: grammars as never,
	themes: [themeDarkPlus, themeLightPlus],
	engine: createJavaScriptRegexEngine(),
});

shikiToMonaco(highlighter, monaco);

const braceConfig: monaco.languages.LanguageConfiguration = {
	comments: { lineComment: '//', blockComment: ['/*', '*/'] },
	brackets: [
		['{', '}'],
		['[', ']'],
		['(', ')'],
	],
	autoClosingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: "'", close: "'", notIn: ['string', 'comment'] },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
		{ open: '`', close: '`', notIn: ['string', 'comment'] },
	],
	surroundingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '<', close: '>' },
		{ open: "'", close: "'" },
		{ open: '"', close: '"' },
		{ open: '`', close: '`' },
	],
	indentationRules: {
		increaseIndentPattern:
			/^.*\{[^}"']*$/,
		decreaseIndentPattern: /^.*\{[^}"']*$/,
	},
	onEnterRules: [
		{
			beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
			afterText: /^\s*\*\/$/,
			action: { indentAction: monaco.languages.IndentAction.IndentOutdent, appendText: ' * ' },
		},
		{
			beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
			action: { indentAction: monaco.languages.IndentAction.None, appendText: ' * ' },
		},
		{
			beforeText: /^(\t|(\s ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
			action: { indentAction: monaco.languages.IndentAction.None, appendText: '* ' },
		},
	],
};

monaco.languages.setLanguageConfiguration('typescript', braceConfig);
monaco.languages.setLanguageConfiguration('typescriptreact', braceConfig);
monaco.languages.setLanguageConfiguration('javascript', braceConfig);
monaco.languages.setLanguageConfiguration('json', {
	brackets: [
		['{', '}'],
		['[', ']'],
	],
	autoClosingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '"', close: '"', notIn: ['string'] },
	],
});
monaco.languages.setLanguageConfiguration('css', {
	comments: { blockComment: ['/*', '*/'] },
	brackets: [
		['{', '}'],
		['[', ']'],
		['(', ')'],
	],
	autoClosingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
		{ open: "'", close: "'", notIn: ['string', 'comment'] },
	],
});

export const DARK_THEME = 'dark-plus';
export const LIGHT_THEME = 'light-plus';

export function setEditorTheme(dark: boolean): void {
	monaco.editor.setTheme(dark ? DARK_THEME : LIGHT_THEME);
}
