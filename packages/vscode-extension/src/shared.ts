import * as vscode from 'vscode';

function isSupportedEditor(editor: vscode.TextEditor | undefined): boolean {
	const languageId = editor?.document.languageId;
	return languageId === 'typescript'
		|| languageId === 'typescriptreact'
		|| languageId === 'javascript'
		|| languageId === 'javascriptreact';
}

export function registerSharedFeatures(context: vscode.ExtensionContext): void {
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
