import vscode from 'vscode';
import assert from 'assert';
import path from 'path';

async function waitFor<T>(
	fn: () => Thenable<T>,
	condition: (result: T) => boolean,
	timeoutMs = 25000,
): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const result = await fn();
		if (result && condition(result)) return result;
		await new Promise(r => setTimeout(r, 500));
	}
	return fn();
}

function fixtureUri(file: string): vscode.Uri {
	const ws = vscode.workspace.workspaceFolders![0].uri.fsPath;
	return vscode.Uri.file(path.join(ws, 'src', file));
}

function hoverText(hovers: vscode.Hover[]): string {
	return hovers.flatMap(h =>
		h.contents.map(c => typeof c === 'string' ? c : c.value)
	).join('\n');
}

suite('DarTsx E2E', function () {
	this.timeout(60000);

	suiteSetup(async function () {
		this.timeout(60000);
		const doc = await vscode.workspace.openTextDocument(fixtureUri('HoverDemo.tsx'));
		await vscode.window.showTextDocument(doc);

		// Wait for TS service to be ready
		await waitFor(
			() => vscode.commands.executeCommand<vscode.Hover[]>(
				'vscode.executeHoverProvider', doc.uri, new vscode.Position(6, 8),
			),
			(hovers) => hovers != null && hovers.length > 0,
			45000,
		);
	});

	// ── Hover keyword overrides ──────────────────────────────────

	function hoverAt(file: string, line: number, col: number) {
		return async (keyword: string) => {
			const doc = await vscode.workspace.openTextDocument(fixtureUri(file));
			const hovers = await waitFor(
				() => vscode.commands.executeCommand<vscode.Hover[]>(
					'vscode.executeHoverProvider', doc.uri, new vscode.Position(line, col),
				),
				(h) => h?.length > 0 && hoverText(h).includes(keyword),
			);
			// Extract the code block content (between ```typescript and ```)
			const raw = hoverText(hovers);
			const match = raw.match(/```typescript\n(?:\(loading\.\.\.\) )?(.*)\n```/s);
			return match ? match[1].split('\n')[0] : raw.trim();
		};
	}

	test('hover: "component" not "function"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 0, 25)('component');
		assert.strictEqual(text, 'component HoverDemo(label: string, value: number, "data-id": string, "aria-label": string): any');
	});

	test('hover: "state" not "let"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 6, 8)('state');
		assert.strictEqual(text, 'state count: number');
	});

	test('hover: "derived" not "const"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 7, 12)('derived');
		assert.strictEqual(text, 'derived doubled: number');
	});

	test('hover: "(prop)" not "(parameter)"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 1, 2)('prop');
		assert.strictEqual(text, '(prop) label: string');
	});

	test('hover: "(binded prop)" for bind param', async () => {
		const text = await hoverAt('HoverDemo.tsx', 2, 7)('binded prop');
		assert.strictEqual(text, '(binded prop) value: number');
	});

	test('hover: "(prop)" for renamed param', async () => {
		const text = await hoverAt('HoverDemo.tsx', 3, 15)('prop');
		assert.strictEqual(text, '(prop) dataId: string');
	});

	test('hover: "(binded prop)" for bind renamed param', async () => {
		const text = await hoverAt('HoverDemo.tsx', 4, 24)('binded prop');
		assert.strictEqual(text, '(binded prop) ariaLabel: string');
	});

	// ── Hover keyword overrides at use sites ─────────────────────

	test('hover use: "(prop)" for prop reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 11, 10)('prop');
		assert.strictEqual(text, '(prop) label: string');
	});

	test('hover use: "state" for state reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 11, 19)('state');
		assert.strictEqual(text, 'state count: number');
	});

	test('hover use: "derived" for derived reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 12, 19)('derived');
		assert.strictEqual(text, 'derived doubled: number');
	});

	test('hover use: "(binded prop)" for bind param reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 13, 17)('binded prop');
		assert.strictEqual(text, '(binded prop) value: number');
	});

	test('hover use: "(prop)" for renamed param reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 14, 14)('prop');
		assert.strictEqual(text, '(prop) dataId: string');
	});

	test('hover use: "(binded prop)" for bind renamed param reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 15, 16)('binded prop');
		assert.strictEqual(text, '(binded prop) ariaLabel: string');
	});

	// ── Hover keyword overrides for imports ──────────────────────

	test('hover import: "state" for imported state at declaration', async () => {
		const text = await hoverAt('ImportDemo.tsx', 0, 9)('state');
		assert.strictEqual(text, '(alias) state count: number');
	});

	test('hover import: "derived" for imported derived at declaration', async () => {
		const text = await hoverAt('ImportDemo.tsx', 0, 16)('derived');
		assert.strictEqual(text, '(alias) derived doubled: number');
	});

	test('hover import: "state" for imported state at use site', async () => {
		const text = await hoverAt('ImportDemo.tsx', 5, 10)('state');
		assert.strictEqual(text, '(alias) state count: number');
	});

	test('hover import: "derived" for imported derived at use site', async () => {
		const text = await hoverAt('ImportDemo.tsx', 6, 10)('derived');
		assert.strictEqual(text, '(alias) derived doubled: number');
	});

	// ── Diagnostics ──────────────────────────────────────────────

	test('unused CSS selector diagnostic', async () => {
		const uri = fixtureUri('UnusedCss.tsx');
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);

		const diags = await waitFor(
			() => Promise.resolve(vscode.languages.getDiagnostics(uri)),
			(d) => d.some(x => x.source === 'dartsx' && x.message.toLowerCase().includes('unused')),
		);

		const unused = diags.filter(d => d.source === 'dartsx' && d.message.toLowerCase().includes('unused'));
		assert.ok(unused.length > 0, `Expected unused CSS diagnostic`);
		assert.ok(unused.some(d => d.message.includes('unused-selector')), `Should mention .unused-selector`);
	});

	test('TypeScript type errors pass through', async () => {
		const uri = fixtureUri('TypeError.tsx');
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);

		const diags = await waitFor(
			() => Promise.resolve(vscode.languages.getDiagnostics(uri)),
			(d) => d.some(x => x.severity === vscode.DiagnosticSeverity.Error && x.source === 'ts'),
		);

		const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error && d.source === 'ts');
		assert.ok(errors.length > 0, `Expected TS type error in TypeError.tsx`);
	});
});
