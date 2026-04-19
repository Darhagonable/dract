/**
 * DarTsx VS Code Extension
 *
 * User-facing DarTsx editor support for JS, TS, JSX, and TSX files.
 * Internally this hooks into VS Code's built-in JavaScript/TypeScript service.
 * Provides:
 *   - Syntax highlighting via TextMate grammar injection
 *   - Diagnostics, completions, hover, go-to-definition via the JS/TS language service integration
 */

import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

const semanticLegend = new vscode.SemanticTokensLegend([
	'keyword',
	'function',
	'variable',
	'parameter',
	'property',
	'string',
]);

function isDarTsxContent(content: string): boolean {
	const sample = content.slice(0, 4096);
	return /\bcomponent\s+\w+\s*\(/.test(sample)
		|| /\bstate\s+\w+\s*=/.test(sample)
		|| /\bderived\s+\w+\s*=/.test(sample)
		|| /\brender\s*\(/.test(sample)
		|| /<[^>]*\bbind:(?:\{[a-zA-Z_]\w*\}|[a-zA-Z][\w-]*)\b/.test(sample);
}

function tokenTypeIndex(type: 'keyword' | 'function' | 'variable' | 'parameter' | 'property' | 'string'): number {
	return semanticLegend.tokenTypes.indexOf(type);
}

function pushToken(builder: vscode.SemanticTokensBuilder, line: number, start: number, length: number, type: 'keyword' | 'function' | 'variable' | 'parameter' | 'property' | 'string'): void {
	if (length <= 0) return;
	builder.push(line, start, length, tokenTypeIndex(type), 0);
}

function addRegexTokens(
	builder: vscode.SemanticTokensBuilder,
	lineText: string,
	lineNumber: number,
	regex: RegExp,
	tokens: Array<{ group: number; type: 'keyword' | 'function' | 'variable' | 'parameter' | 'property' | 'string' }>,
): void {
	for (const match of lineText.matchAll(regex)) {
		for (const token of tokens) {
			const value = match[token.group];
			if (!value) continue;
			const groupOffset = match[0].indexOf(value);
			if (groupOffset === -1 || match.index === undefined) continue;
			pushToken(builder, lineNumber, match.index + groupOffset, value.length, token.type);
		}
	}
}

class DarTsxSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
		const text = document.getText();
		if (!isDarTsxContent(text)) {
			return new vscode.SemanticTokensBuilder(semanticLegend).build();
		}

		const builder = new vscode.SemanticTokensBuilder(semanticLegend);
		for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
			const lineText = document.lineAt(lineNumber).text;

			addRegexTokens(builder, lineText, lineNumber, /\b(component)(\s+)([A-Za-z_$][\w$]*)/g, [
				{ group: 1, type: 'keyword' },
				{ group: 3, type: 'function' },
			]);

			addRegexTokens(builder, lineText, lineNumber, /^(\s*)(state)(\s+)([A-Za-z_$][\w$]*)/g, [
				{ group: 2, type: 'keyword' },
				{ group: 4, type: 'variable' },
			]);

			addRegexTokens(builder, lineText, lineNumber, /^(\s*)(derived)(\s+)([A-Za-z_$][\w$]*)/g, [
				{ group: 2, type: 'keyword' },
				{ group: 4, type: 'variable' },
			]);

			addRegexTokens(builder, lineText, lineNumber, /^(\s*)(render)(?=\s*\()/g, [
				{ group: 2, type: 'keyword' },
			]);

			addRegexTokens(builder, lineText, lineNumber, /(^\s*|[,(]\s*)(bind)(?=\s+(?:['"]|[A-Za-z_$]))/g, [
				{ group: 2, type: 'keyword' },
			]);

			addRegexTokens(builder, lineText, lineNumber, /(['"][^'"]+['"])(\s+as\s+)([A-Za-z_$][\w$]*)/g, [
				{ group: 1, type: 'string' },
				{ group: 2, type: 'keyword' },
				{ group: 3, type: 'parameter' },
			]);

			addRegexTokens(builder, lineText, lineNumber, /\b(bind)(:)([A-Za-z][\w-]*)/g, [
				{ group: 1, type: 'keyword' },
				{ group: 3, type: 'property' },
			]);
		}

		return builder.build();
	}
}

function isSupportedEditor(editor: vscode.TextEditor | undefined): boolean {
	const languageId = editor?.document.languageId;
	return languageId === 'typescript'
		|| languageId === 'typescriptreact'
		|| languageId === 'javascript'
		|| languageId === 'javascriptreact';
}

export function activate(context: vscode.ExtensionContext): void {
	// Start the Volar language server for CSS features in <style> blocks
	const serverModule = require.resolve('./server');
	client = new LanguageClient(
		'dartsx',
		'DarTsx Language Server',
		{
			run: { module: serverModule, transport: TransportKind.ipc },
			debug: { module: serverModule, transport: TransportKind.ipc },
		},
		{
			documentSelector: [
				{ language: 'javascript' },
				{ language: 'javascriptreact' },
				{ language: 'typescript' },
				{ language: 'typescriptreact' },
			],
		},
	);
	client.start().catch(err => {
		console.error('[DarTsx] Language server failed to start:', err);
	});

	const selector: vscode.DocumentSelector = [
		{ language: 'javascript' },
		{ language: 'javascriptreact' },
	];

	context.subscriptions.push(
		vscode.languages.registerDocumentSemanticTokensProvider(
			selector,
			new DarTsxSemanticTokensProvider(),
			semanticLegend,
		),
	);

	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBar.text = '$(zap) DarTsx';
	statusBar.tooltip = 'DarTsx language support active';

	context.subscriptions.push(statusBar);

	const updateStatusBar = (editor: vscode.TextEditor | undefined) => {
		if (isSupportedEditor(editor)) {
			statusBar.show();
			return;
		}
		statusBar.hide();
	};

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
	updateStatusBar(vscode.window.activeTextEditor);
}

export async function deactivate(): Promise<void> {
	if (client) {
		await client.stop();
	}
}
