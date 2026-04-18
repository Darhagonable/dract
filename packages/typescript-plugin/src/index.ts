/**
 * DarTsx TypeScript Language Service Plugin (Volar-based)
 *
 * Loaded by tsserver when configured in tsconfig.json.
 * Transforms DarTsx .tsx files into valid TypeScript via the Volar framework,
 * providing intellisense, diagnostics, hover, completions, and navigation.
 *
 * Wraps Volar's Proxy-based service with an outer Proxy that intercepts
 * getQuickInfoAtPosition to display DarTsx keywords (component, state,
 * derived) instead of their TypeScript equivalents (function, let, const).
 */

import { createLanguageServicePlugin } from '@volar/typescript/lib/quickstart/createLanguageServicePlugin';
import { getDarTsxLanguagePlugin } from './language';
import { isDarTsxFile } from './dartsx-to-tsx';
import * as fs from 'fs';
import { htmlData } from 'vscode-html-languageservice/lib/umd/languageFacts/data/webCustomData';

/** Prebuilt lookup: HTML/SVG tag name → { description, references, baseline } */
interface HtmlTagDoc {
	description: string;
	references: { name: string; url: string }[];
	baseline: string; // e.g. "![Baseline icon](...) _Widely available..._" or ""
}

const BASELINE_HIGH_ICON = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgIGZpbGw6ICNDNEVFRDA7IC8qIExpZ2h0IG1vZGUgKi8KICAgIH0KCiAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7CiAgICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgICAgZmlsbDogIzEyNTIyNTsgLyogRGFyayBtb2RlICovCiAgICAgIH0KICAgIH0KICA8L3N0eWxlPgogIDxwYXRoIGQ9Ik00MjAgMzBMMzkwIDYwTDQ4MCAxNTBMMzkwIDI0MEwzMzAgMTgwTDMwMCAyMTBMMzkwIDMwMEw1NDAgMTUwTDQyMCAzMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0xNTAgMEwzMCAxMjBMNjAgMTUwTDE1MCA2MEwyMTAgMTIwTDI0MCA5MEwxNTAgMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0zOTAgMEw0MjAgMzBMMTUwIDMwMEwwIDE1MEwzMCAxMjBMMTUwIDI0MEwzOTAgMFoiIGZpbGw9IiMxRUE0NDYiLz4KPC9zdmc+';
const BASELINE_LOW_ICON = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ibHVlLXNoYXBlIHsKICAgICAgZmlsbDogI0E4QzdGQTsgLyogTGlnaHQgbW9kZSAqLwogICAgfQoKICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgLmJsdWUtc2hhcGUgewogICAgICAgIGZpbGw6ICMyRDUwOUU7IC8qIERhcmsgbW9kZSAqLwogICAgICB9CiAgICB9CgogICAgLmRhcmtlci1ibHVlLXNoYXBlIHsKICAgICAgICBmaWxsOiAjMUI2RUYzOwogICAgfQoKICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgICAuZGFya2VyLWJsdWUtc2hhcGUgewogICAgICAgICAgICBmaWxsOiAjNDE4NUZGOwogICAgICAgIH0KICAgIH0KCiAgPC9zdHlsZT4KICA8cGF0aCBkPSJNMTUwIDBMMTgwIDMwTDE1MCA2MEwxMjAgMzBMMTUwIDBaIiBjbGFzcz0iYmx1ZS1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0yMTAgNjBMMjQwIDkwTDIxMCAxMjBMMTgwIDkwTDIxMCA2MFoiIGNsYXNzPSJibHVlLXNoYXBlIi8+CiAgPHBhdGggZD0iTTQ1MCA2MEw0ODAgOTBMNDUwIDEyMEw0MjAgOTBMNDUwIDYwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNNTEwIDEyMEw1NDAgMTUwTDUxMCAxODBMNDgwIDE1MEw1MTAgMTIwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNNDUwIDE4MEw0ODAgMjEwTDQ1MCAyNDBMNDIwIDIxMEw0NTAgMTgwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNMzkwIDI0MEw0MjAgMjcwTDM5MCAzMDBMMzYwIDI3MEwzOTAgMjQwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNMzMwIDE4MEwzNjAgMjEwTDMzMCAyNDBMMzAwIDIxMEwzMzAgMTgwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNOTAgNjBMMTIwIDkwTDkwIDEyMEw2MCA5MEw5MCA2MFoiIGNsYXNzPSJibHVlLXNoYXBlIi8+CiAgPHBhdGggZD0iTTM5MCAwTDQyMCAzMEwxNTAgMzAwTDAgMTUwTDMwIDEyMEwxNTAgMjQwTDM5MCAwWiIgY2xhc3M9ImRhcmtlci1ibHVlLXNoYXBlIi8+Cjwvc3ZnPg==';

const htmlTagDocs = new Map<string, HtmlTagDoc>();
for (const tag of htmlData.tags ?? []) {
	const desc = typeof tag.description === 'string'
		? tag.description
		: (tag.description as { kind: string; value: string })?.value ?? '';
	const status = (tag as any).status as { baseline?: string; baseline_low_date?: string; baseline_high_date?: string } | undefined;
	let baseline = '';
	if (status?.baseline === 'high' && status.baseline_low_date) {
		const year = status.baseline_low_date.substring(0, 4);
		baseline = `![Baseline icon](${BASELINE_HIGH_ICON}) _Widely available across major browsers (Baseline since ${year})_`;
	} else if (status?.baseline === 'low' && status.baseline_low_date) {
		const year = status.baseline_low_date.substring(0, 4);
		baseline = `![Baseline icon](${BASELINE_LOW_ICON}) _Newly available across major browsers (Baseline since ${year})_`;
	}
	htmlTagDocs.set(tag.name, {
		description: desc,
		references: (tag.references ?? []) as { name: string; url: string }[],
		baseline,
	});
}

const baseInit = createLanguageServicePlugin(() => ({
	languagePlugins: [getDarTsxLanguagePlugin()],
}));

const init: typeof baseInit = (modules) => {
	const base = baseInit(modules);
	return {
		...base,
		create(info) {
			const service = base.create(info);
			// Volar returns a Proxy whose get trap caches methods,
			// so property assignment doesn't stick. Wrap with our own Proxy.
			return new Proxy(service, {
				get(target, prop, receiver) {
					if (prop === 'getQuickInfoAtPosition') {
						return (fileName: string, position: number) => {
							return getQuickInfoWithDarTsxKeywords(target, fileName, position);
						};
					}
					if (prop === 'getSyntacticDiagnostics' || prop === 'getSemanticDiagnostics' || prop === 'getSuggestionDiagnostics') {
						const original = target[prop];
						return (fileName: string) => {
							const diags = original.call(target, fileName);
							return filterDarTsxDiagnostics(diags, fileName);
						};
					}
					return Reflect.get(target, prop, receiver);
				},
			});
		},
	};
};

function getQuickInfoWithDarTsxKeywords(
	service: import('typescript').LanguageService,
	fileName: string,
	position: number,
): import('typescript').QuickInfo | undefined {
	const result = service.getQuickInfoAtPosition(fileName, position);
	if (!result?.displayParts?.length) return result;

	let content: string;
	try {
		content = fs.readFileSync(fileName, 'utf-8');
	} catch {
		return result;
	}
	if (!isDarTsxFile(content)) return result;
	rewriteComponentPropsOverload(result);

	const first = result.displayParts[0];

	// Rewrite (parameter) → (prop) or (binded prop) for component params
	if (first.kind === 'punctuation' && first.text === '(' && result.displayParts.length >= 3) {
		const label = result.displayParts[1];
		const close = result.displayParts[2];
		if (label.kind === 'text' && label.text === 'parameter' && close.kind === 'punctuation' && close.text === ')') {
			rewriteParameterLabel(service, result, fileName, position, content);
		}
	}

	// Rewrite keywords: function → component, let/var → state, const/var → derived
	if (first.kind === 'keyword') {
		if (first.text === 'function' || first.text === 'let' || first.text === 'const' || first.text === 'var') {
			if (tryRewriteKeyword(first, content, result.textSpan.start)) {
				return result;
			}
			const defSite = getDefinitionSite(service, fileName, position, content);
			if (defSite) {
				tryRewriteKeyword(first, defSite.content, defSite.textSpan.start);
			}
		}
	}

	// Rewrite aliased imports: (alias) let → (alias) state, (alias) const → (alias) derived, etc.
	// Also fix `any` types caused by TS2632 (assignment to imported binding) by looking up definition type.
	if (first.kind === 'punctuation' && first.text === '(' && result.displayParts.length >= 5) {
		const label = result.displayParts[1];
		if (label.kind === 'text' && label.text === 'alias') {
			const kwPart = result.displayParts.find(p => p.kind === 'keyword' &&
				(p.text === 'let' || p.text === 'const' || p.text === 'var' || p.text === 'function'));
			if (kwPart) {
				const defSite = getDefinitionSite(service, fileName, position, content);
				if (defSite && isDarTsxFile(defSite.content)) {
					tryRewriteKeyword(kwPart, defSite.content, defSite.textSpan.start);
					fixAliasAnyType(service, result, defSite.fileName, defSite.textSpan.start);
				}
			}
		}
	}

	// Append HTML/SVG tag documentation (description + MDN link) for intrinsic elements
	appendHtmlTagDocumentation(result, content);

	return result;
}

function rewriteComponentPropsOverload(result: import('typescript').QuickInfo): void {
	if (!result.displayParts?.length) return;

	const text = result.displayParts.map((part) => part.text).join('');
	if (!/^(?:\(alias\)\s+)?(?:function|component)\s+[A-Za-z_$][\w$]*\(props:\s*\{/.test(text)) return;

	const rewritten = text
		.replace(/^((?:\(alias\)\s+)?)function\b/, '$1component')
		.replace(/\(props:\s*\{/, '(')
		.replace(/\}\)(?=:\s*)/, ')');

	if (rewritten === text) return;

	result.displayParts = [
		{ kind: 'text', text: rewritten },
	];
}

/** Append HTML/SVG element description + baseline + MDN reference when hovering over an intrinsic JSX tag. */
function appendHtmlTagDocumentation(result: import('typescript').QuickInfo, content: string): void {
	if (!result.displayParts?.length) return;

	// Extract the hovered token from source
	const word = content.substring(result.textSpan.start, result.textSpan.start + result.textSpan.length);

	const tagDoc = htmlTagDocs.get(word);
	if (!tagDoc) return;

	// Confirm this is a JSX intrinsic element hover (not a variable named e.g. "div")
	const text = result.displayParts.map(p => p.text).join('');
	if (!/\bJSX\b/.test(text) && !/\bIntrinsicElements\b/.test(text)) {
		if (!/^\(property\)/.test(text)) return;
	}

	// Replace the "(property) SvelteHTMLElements.div: ..." display with just the tag name
	result.displayParts = [
		{ kind: 'keyword', text: '(element)' },
		{ kind: 'space', text: ' ' },
		{ kind: 'tagName', text: `<${word}>` },
	];

	// Build documentation
	const docParts: import('typescript').SymbolDisplayPart[] = [];
	if (tagDoc.description) {
		docParts.push({ kind: 'text', text: tagDoc.description });
	}
	if (tagDoc.baseline) {
		docParts.push({ kind: 'text', text: `\n\n${tagDoc.baseline}` });
	}
	for (const ref of tagDoc.references) {
		docParts.push({ kind: 'text', text: `\n\n[${ref.name}](${ref.url})` });
	}
	if (docParts.length) {
		result.documentation = docParts;
	}
}

function rewriteParameterLabel(
	service: import('typescript').LanguageService,
	result: import('typescript').QuickInfo,
	fileName: string,
	position: number,
	content: string,
): void {
	if (!result.displayParts || result.displayParts.length < 3) return;

	const first = result.displayParts[0];
	const label = result.displayParts[1];
	const close = result.displayParts[2];
	if (first.kind !== 'punctuation' || first.text !== '(') return;
	if (label.kind !== 'text' || label.text !== 'parameter') return;
	if (close.kind !== 'punctuation' || close.text !== ')') return;

	const paramName = getParamName(result.displayParts);
	if (!paramName) return;

	if (isInsideComponent(content, result.textSpan.start)) {
		label.text = isBoundParam(content, result.textSpan.start)
			? 'binded prop'
			: 'prop';
		return;
	}

	const defSite = getDefinitionSite(service, fileName, position, content);
	if (!defSite || !isDarTsxFile(defSite.content)) return;
	if (!isInsideComponent(defSite.content, defSite.textSpan.start)) return;

	label.text = isBoundParam(defSite.content, defSite.textSpan.start)
		? 'binded prop'
		: 'prop';
}

function getDefinitionSite(
	service: import('typescript').LanguageService,
	fileName: string,
	position: number,
	content: string,
): { fileName: string; content: string; textSpan: import('typescript').TextSpan } | undefined {
	try {
		const defs = service.getDefinitionAtPosition(fileName, position);
		if (!defs?.length) return undefined;

		const def = defs[0];
		return {
			fileName: def.fileName,
			content: def.fileName === fileName ? content : fs.readFileSync(def.fileName, 'utf-8'),
			textSpan: def.textSpan,
		};
	} catch {
		return undefined;
	}
}

/**
 * When an alias shows `any` type (e.g. due to TS2632 on imported state assignment),
 * look up the definition's quickinfo and replace the type parts.
 */
function fixAliasAnyType(
	service: import('typescript').LanguageService,
	result: import('typescript').QuickInfo,
	defFileName: string,
	defPosition: number,
): void {
	if (!result.displayParts) return;

	// Find the type portion: look for `: any` pattern in displayParts
	// Structure: ... name : space any lineBreak ...
	const colonIdx = result.displayParts.findIndex(p => p.kind === 'punctuation' && p.text === ':');
	if (colonIdx === -1) return;

	// Check if the type after `: ` is just `any`
	const typeStart = colonIdx + 1; // skip `:`
	// Find the lineBreak or end of the first line of parts
	let typeEnd = result.displayParts.length;
	for (let i = typeStart; i < result.displayParts.length; i++) {
		if (result.displayParts[i].kind === 'lineBreak') {
			typeEnd = i;
			break;
		}
	}

	const typeParts = result.displayParts.slice(typeStart, typeEnd);
	const typeText = typeParts.map(p => p.text).join('').trim();
	if (typeText !== 'any') return;

	// Get quickinfo at the definition site
	const defInfo = service.getQuickInfoAtPosition(defFileName, defPosition);
	if (!defInfo?.displayParts) return;

	// Extract type parts from definition: everything after the first `:`
	const defColonIdx = defInfo.displayParts.findIndex(p => p.kind === 'punctuation' && p.text === ':');
	if (defColonIdx === -1) return;

	let defTypeEnd = defInfo.displayParts.length;
	for (let i = defColonIdx + 1; i < defInfo.displayParts.length; i++) {
		if (defInfo.displayParts[i].kind === 'lineBreak') {
			defTypeEnd = i;
			break;
		}
	}

	const defTypeParts = defInfo.displayParts.slice(defColonIdx + 1, defTypeEnd);
	if (defTypeParts.length === 0) return;

	// Replace the type parts in the alias result
	result.displayParts.splice(typeStart, typeEnd - typeStart, ...defTypeParts);
}

/** Check if a position is inside a component's parameter list */
function isInsideComponent(source: string, pos: number): boolean {
	// Walk backwards to find the enclosing function/component
	const before = source.substring(0, pos);
	// Find the last `component` keyword before this position
	const lastComp = before.lastIndexOf('component ');
	if (lastComp === -1) return false;
	// Make sure there's an opening paren between component and pos
	const parenIdx = source.indexOf('(', lastComp);
	if (parenIdx === -1 || parenIdx >= pos) return false;
	// Make sure the closing paren for this component hasn't been reached yet
	const closeParen = findMatchingParen(source, parenIdx);
	return closeParen === -1 || pos <= closeParen;
}

/** Check if a param has `bind` prefix in the original source */
function isBoundParam(source: string, identStart: number): boolean {
	const before = source.substring(Math.max(0, identStart - 120), identStart);
	return /\bbind\s+(?:['"][^'"]+['"]\s+as\s+)?$/.test(before);
}

/** Extract parameter name from displayParts */
function getParamName(parts: import('typescript').SymbolDisplayPart[]): string | undefined {
	// Parts: ( parameter ) space name : space type
	// Index:  0    1      2   3    4  5   6   7
	for (const part of parts) {
		if (part.kind === 'parameterName' || part.kind === 'localName') {
			return part.text;
		}
	}
	return undefined;
}

function findMatchingParen(source: string, openIdx: number): number {
	let depth = 1;
	for (let i = openIdx + 1; i < source.length; i++) {
		if (source[i] === '(') depth++;
		else if (source[i] === ')') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function tryRewriteKeyword(
	part: import('typescript').SymbolDisplayPart,
	source: string,
	identStart: number,
): boolean {
	const before = source.substring(Math.max(0, identStart - 20), identStart);
	if (part.text === 'function' && /\bcomponent\s+$/.test(before)) {
		part.text = 'component';
		return true;
	}
	if ((part.text === 'let' || part.text === 'var') && /\bstate\s+$/.test(before)) {
		part.text = 'state';
		return true;
	}
	if ((part.text === 'const' || part.text === 'var') && /\bderived\s+$/.test(before)) {
		part.text = 'derived';
		return true;
	}
	return false;
}

const SUPPRESS_CODES = new Set([
	1003, 1005, 1109, 1128, 1136, 1381, 1434,
	2304, 2322, 2339, 2362, 2552, 2632, 2693, 2695, 2724, 2747, 2809,
	6385, 7026,
]);

function filterDarTsxDiagnostics(
	diags: import('typescript').Diagnostic[],
	fileName: string,
): import('typescript').Diagnostic[] {
	if (!diags.length) return diags;
	let content: string | undefined;
	try {
		content = fs.readFileSync(fileName, 'utf-8');
	} catch {
		return diags;
	}
	if (!isDarTsxFile(content)) return diags;
	return diags.filter(d => !d.code || !SUPPRESS_CODES.has(d.code));
}

export = init;
