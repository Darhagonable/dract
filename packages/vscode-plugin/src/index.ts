/**
 * DarTsx VS Code Extension
 *
 * Activates the DarTsx TypeScript plugin for .tsx files containing DarTsx syntax.
 * Provides:
 *   - Syntax highlighting via TextMate grammar injection
 *   - Diagnostics, completions, hover, go-to-definition via the TS plugin (Volar-based)
 */

import * as vscode from 'vscode';

function isTypeScriptEditor(editor: vscode.TextEditor | undefined): boolean {
	const languageId = editor?.document.languageId;
	return languageId === 'typescript' || languageId === 'typescriptreact';
}

export function activate(context: vscode.ExtensionContext): void {
	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBar.text = '$(zap) DarTsx';
	statusBar.tooltip = 'DarTsx language support active';

	context.subscriptions.push(statusBar);

	const updateStatusBar = (editor: vscode.TextEditor | undefined) => {
		if (isTypeScriptEditor(editor)) {
			statusBar.show();
			return;
		}
		statusBar.hide();
	};

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
	updateStatusBar(vscode.window.activeTextEditor);
}

export function deactivate(): void { }
