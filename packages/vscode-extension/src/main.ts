/**
 * DarTsx VS Code Extension — desktop (Node) entry
 *
 * User-facing DarTsx editor support for JS, TS, JSX, and TSX files.
 * Internally this hooks into VS Code's built-in JavaScript/TypeScript service.
 * Provides:
 *   - Syntax highlighting via TextMate grammar injection
 *   - Diagnostics, completions, hover, go-to-definition via the JS/TS language service integration
 *   - CSS features in <style> blocks via the Volar language server
 */

import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import { registerSharedFeatures } from './shared';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
	registerSharedFeatures(context);

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
}

export async function deactivate(): Promise<void> {
	if (client) {
		await client.stop();
	}
}
