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
import { isDarTsxFile, findSuppressZones, type SuppressZone } from './dartsx-to-tsx';
import * as fs from 'fs';
import { analyzeUnusedCss, DARTSX_UNUSED_CSS_CODE } from './unused-css';

const baseInit = createLanguageServicePlugin(() => ({
	languagePlugins: [getDarTsxLanguagePlugin()],
}));

const init: typeof baseInit = (modules) => {
	const ts = modules.typescript;
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
							let diags = original.call(target, fileName);
							diags = filterDarTsxDiagnostics(diags, fileName);
							if (prop === 'getSemanticDiagnostics') {
								diags = [...diags, ...getUnusedCssDiagnostics(fileName, ts)];
							}
							return diags;
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

	// Rewrite (parameter)/(property) → (prop) or (binded prop) for component params
	if (first.kind === 'punctuation' && first.text === '(' && result.displayParts.length >= 3) {
		const label = result.displayParts[1];
		const close = result.displayParts[2];
		if (label.kind === 'text' && (label.text === 'parameter' || label.text === 'property') && close.kind === 'punctuation' && close.text === ')') {
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

	return result;
}

function rewriteComponentPropsOverload(result: import('typescript').QuickInfo): void {
	if (!result.displayParts?.length) return;

	const text = result.displayParts.map((part) => part.text).join('');

	// Match destructured style: Foo({ a, b }: { a: T; b: U; }): R
	const prefixMatch = text.match(
		/^((?:\(alias\)\s+)?(?:function|component)\s+[A-Za-z_$][\w$]*)\(\{/
	);
	if (!prefixMatch) return;

	// Find `}: ` separator between destructuring and type annotation
	const sepIdx = text.indexOf('}:', prefixMatch[0].length);
	if (sepIdx === -1) return;

	// Find the opening `{` of the type annotation after `}: `
	const typeOpenIdx = text.indexOf('{', sepIdx + 2);
	if (typeOpenIdx === -1) return;

	// Find the matching `}` for the type annotation
	let depth = 1;
	let i = typeOpenIdx + 1;
	while (i < text.length && depth > 0) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}') depth--;
		i++;
	}
	if (depth !== 0) return;
	const typeCloseIdx = i - 1;

	// After `})` get return type (up to next newline) and trailing content
	const afterSig = text.slice(typeCloseIdx + 2); // skip `})`
	const returnMatch = afterSig.match(/^(:\s*[^\n]+)([\s\S]*)$/);
	if (!returnMatch) return;

	const prefix = prefixMatch[1].replace(/\bfunction\b/, 'component');
	const typeBody = text.slice(typeOpenIdx + 1, typeCloseIdx);
	const returnType = returnMatch[1];
	const trailing = returnMatch[2];

	// Parse type members: "className?: string; children: any; [key: string]: any"
	const members = typeBody.split(';').map(s => s.trim()).filter(Boolean);
	const params: string[] = [];
	let hasIndexSig = false;

	for (const m of members) {
		if (/^\[/.test(m)) {
			hasIndexSig = true;
			continue;
		}
		const pm = m.match(/^('(?:[^']+)'|"(?:[^"]+)"|[\w$]+)(\?)?:\s*(.+)$/);
		if (pm) {
			params.push(`${pm[1]}${pm[2] || ''}: ${pm[3]}`);
		}
	}
	if (hasIndexSig) {
		params.push('...rest: any[]');
	}

	const rewritten = `${prefix}(${params.join(', ')})${returnType}${trailing}`;
	result.displayParts = [{ kind: 'text', text: rewritten }];
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
	if (label.kind !== 'text' || (label.text !== 'parameter' && label.text !== 'property')) return;
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
	for (const part of parts) {
		if (part.kind === 'parameterName' || part.kind === 'localName' || part.kind === 'propertyName') {
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
	// For destructured bindings, scan back past `{ ..., ` or `[ ..., ` to find the keyword
	let scanStart = identStart;
	const charBefore = source[scanStart - 1];
	if (charBefore === ' ' || charBefore === '\t' || charBefore === ',' || charBefore === '\n') {
		// Walk backward to find the opening { or [
		let k = scanStart - 1;
		let depth = 0;
		while (k >= 0) {
			const ch = source[k];
			if (ch === '}' || ch === ']') depth++;
			else if (ch === '{' || ch === '[') {
				if (depth === 0) { scanStart = k; break; }
				depth--;
			}
			k--;
		}
	}
	const before = source.substring(Math.max(0, scanStart - 20), scanStart);
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

// Errors always suppressed in DarTsx files (syntax errors from custom keywords,
// and semantic errors that are always false positives from the transform)
const ALWAYS_SUPPRESS = new Set([
	1003, 1005, 1109, 1128, 1136, 1381, 1434,
	2304, 2362, 2552, 2632, 2657, 2693, 2695, 2724, 2809,
	6385, 7026,
]);

// Errors suppressed only when they occur inside DarTsx-specific zones
// (control flow in JSX, bind: attributes) — legitimate type errors
// outside these zones are preserved (e.g. className vs class, fillOpacity vs fill-opacity)
const ZONE_SUPPRESS = new Set([
	2322, // Type 'X' is not assignable to type 'Y'
	2339, // Property 'X' does not exist on type 'Y'
	2747, // 'X' is not a valid JSX element
]);

function filterDarTsxDiagnostics(
	diags: import('typescript').Diagnostic[],
	fileName: string,
): import('typescript').Diagnostic[] {
	if (!diags.length) return diags;
	let content: string;
	try {
		content = fs.readFileSync(fileName, 'utf-8');
	} catch {
		return diags;
	}
	if (!isDarTsxFile(content)) return diags;

	let zones: SuppressZone[] | undefined;

	return diags.filter(d => {
		if (!d.code) return true;
		if (ALWAYS_SUPPRESS.has(d.code)) return false;
		if (ZONE_SUPPRESS.has(d.code)) {
			if (!zones) zones = findSuppressZones(content);
			const start = d.start ?? 0;
			return !zones.some(z => start >= z.start && start < z.end);
		}
		return true;
	});
}

// ── Unused CSS selector detection ──────────────────────────────────

function getUnusedCssDiagnostics(fileName: string, ts: typeof import('typescript')): import('typescript').Diagnostic[] {
	let content: string;
	try {
		content = fs.readFileSync(fileName, 'utf-8');
	} catch {
		return [];
	}
	if (!isDarTsxFile(content)) return [];

	const warnings = analyzeUnusedCss(content);
	if (warnings.length === 0) return [];

	const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	return warnings.map(w => ({
		file: sourceFile,
		start: w.start,
		length: w.length,
		messageText: w.message,
		category: 0 as import('typescript').DiagnosticCategory,
		code: DARTSX_UNUSED_CSS_CODE,
		source: 'dartsx',
	}));
}

export = init;
