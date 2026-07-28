import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import manifest from 'dartsx-vscode/package.json';
import renderGrammar from 'dartsx-vscode/syntaxes/dartsx.render.injection.tmLanguage.json?raw';
import styleGrammar from 'dartsx-vscode/syntaxes/dartsx.style.injection.tmLanguage.json?raw';
import cssExprGrammar from 'dartsx-vscode/syntaxes/dartsx.css-expressions.injection.tmLanguage.json?raw';
import pluginUrl from 'dartsx-typescript-plugin?url';

const { registerFileUrl } = registerExtension(manifest as any);

function registerFile(path: string, content: string, mime?: string) {
	const type = mime ?? 'application/json';
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	registerFileUrl(path, url, { mimeType: type });
}

registerFile('./syntaxes/dartsx.render.injection.tmLanguage.json', renderGrammar);
registerFile('./syntaxes/dartsx.style.injection.tmLanguage.json', styleGrammar);
registerFile('./syntaxes/dartsx.css-expressions.injection.tmLanguage.json', cssExprGrammar);

registerFile(
	'./dartsx-typescript-plugin/package.json',
	JSON.stringify({ name: 'dartsx-typescript-plugin', main: 'index.js' }),
	'application/json',
);

registerFileUrl('./dartsx-typescript-plugin/index.js', pluginUrl, { mimeType: 'text/javascript' });
