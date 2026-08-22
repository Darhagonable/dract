/**
 * DarTsx VS Code Extension — browser entry
 *
 * Minimal browser support: syntax highlighting (TextMate injections) and
 * semantic tokens. The Volar language server and the TypeScript server
 * plugin are desktop-only and are not started here.
 */

import * as vscode from 'vscode';
import { registerSharedFeatures } from './shared';

export function activate(context: vscode.ExtensionContext): void {
	registerSharedFeatures(context);
}

export function deactivate(): void {}
