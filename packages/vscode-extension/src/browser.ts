import * as vscode from 'vscode';
import { registerSharedFeatures } from './shared';

export function activate(context: vscode.ExtensionContext): void {
	registerSharedFeatures(context);
}

export function deactivate(): void { }
