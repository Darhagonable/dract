// Grammar + theme wiring for the editor: Shiki (vscode-textmate engine) on
// monaco-editor-core — the vue-repl pattern. This replaces the VS Code
// extension host + vsix: syntax coloring comes from Shiki's TS grammars with
// the DarTsx injection grammars merged in, and themes are the exact Dark/Light
// Modern JSONs used by desktop VS Code.
//
// Injection mechanics: the vsix ships standalone injection grammars (top-level
// `injectionSelector`), which vscode-textmate only applies when the HOST wires
// them (VS Code's extension host does; nothing else does). The engine's other
// injection path — a grammar's own `injections` map — needs no host support,
// so each injection grammar is merged into the TS/TSX roots: its repository is
// prefixed into the base grammar's repository and its patterns become the rule
// for its selector. Same rules, same engine, no extension host.

import * as monaco from 'monaco-editor-core';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine-javascript.mjs';
import { shikiToMonaco } from '@shikijs/monaco';
import langTs from 'shiki/langs/typescript.mjs';
import langTsx from 'shiki/langs/tsx.mjs';
import langJson from 'shiki/langs/json.mjs';
import langCss from 'shiki/langs/css.mjs';
import themeDarkPlus from 'shiki/themes/dark-plus.mjs';
import themeLightPlus from 'shiki/themes/light-plus.mjs';
// The source of truth for these grammars is the desktop extension's syntaxes/
// directory, imported via the workspace package — repl and VS Code can't drift.
import renderGrammar from '@dartsx/language-service/syntaxes/dartsx.render.injection.tmLanguage.json';
import styleGrammar from '@dartsx/language-service/syntaxes/dartsx.style.injection.tmLanguage.json';
import cssExpressionsGrammar from '@dartsx/language-service/syntaxes/dartsx.css-expressions.injection.tmLanguage.json';

const INJECTIONS = [renderGrammar, styleGrammar, cssExpressionsGrammar] as Array<{
	injectionSelector: string;
	patterns: unknown[];
	repository?: Record<string, unknown>;
}>;

interface TmRule {
	[name: string]: unknown;
	patterns?: TmRule[];
	include?: string;
}

function rewriteIncludes(node: unknown, prefix: string): unknown {
	if (Array.isArray(node)) return node.map(item => rewriteIncludes(item, prefix));
	if (node && typeof node === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			if (key === 'include' && typeof value === 'string' && value.startsWith('#')) {
				out[key] = '#' + prefix + value.slice(1);
			} else {
				out[key] = rewriteIncludes(value, prefix);
			}
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

// Shiki resolves a language by its registration's `name`; monaco's ids are
// typescriptreact/typescript/json — align them so shikiToMonaco wires token
// providers for the ids our models use.
const tsxRegistration = langTsx.map(entry =>
	entry.scopeName === 'source.tsx'
		? { ...mergeInjections(entry, 'tsx-'), name: 'typescriptreact', aliases: ['tsx'] }
		: entry,
);
const tsRegistration = langTs.map(entry =>
	entry.scopeName === 'source.ts'
		? mergeInjections(entry, 'ts-')
		: entry,
);

const tsLanguageConfiguration: monaco.languages.LanguageConfiguration = {
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
		{ open: '`', close: '`' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
		{ open: "'", close: "'", notIn: ['string', 'comment'] },
	],
	surroundingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '"', close: '"' },
		{ open: "'", close: "'" },
	],
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
			beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
			action: { indentAction: monaco.languages.IndentAction.None, appendText: '* ' },
		},
	],
};

monaco.languages.register({ id: 'typescript', extensions: ['.ts'] });
monaco.languages.setLanguageConfiguration('typescript', tsLanguageConfiguration);
monaco.languages.register({ id: 'typescriptreact', extensions: ['.tsx'] });
monaco.languages.setLanguageConfiguration('typescriptreact', tsLanguageConfiguration);
monaco.languages.register({ id: 'json', extensions: ['.json'] });

// Themes come from Shiki's bundled set (package-provided, nothing vendored
// here): VS Code's classic Dark+/Light+ pairs — the same choice the vue repl
// makes. Grammar coloring is unaffected; only chrome colors differ slightly
// from VS Code's "Modern" variants.
export const DARK_THEME = 'dark-plus';
export const LIGHT_THEME = 'light-plus';

// css is required for the <style> injection's external `include: source.css`
// (an unresolvable include silently no-ops in vscode-textmate).
const highlighter = createHighlighterCoreSync({
	themes: [themeDarkPlus as never, themeLightPlus as never],
	langs: [tsxRegistration as never, tsRegistration as never, langJson as never, langCss as never],
	engine: createJavaScriptRegexEngine(),
});

shikiToMonaco(highlighter, monaco as never);

export function themeName(dark: boolean): string {
	return dark ? DARK_THEME : LIGHT_THEME;
}
