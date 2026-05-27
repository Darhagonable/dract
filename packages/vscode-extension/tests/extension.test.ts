import { describe, it, expect, beforeAll } from 'vitest';
import * as vscode from 'vscode';
import path from 'path';

const fixtureDir = path.resolve(import.meta.dirname!, 'fixture');

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
	return vscode.Uri.file(path.join(fixtureDir, 'src', file));
}

function hoverText(hovers: vscode.Hover[]): string {
	return hovers.flatMap(h =>
		h.contents.map(c => typeof c === 'string' ? c : c.value)
	).join('\n');
}

describe('VSCode Extension', () => {
	it('extension activates', async () => {
		const ext = vscode.extensions.getExtension('dartsx.dartsx-vscode');
		expect(ext).toBeDefined();
		await ext!.activate();
		expect(ext!.isActive).toBe(true);
	});

	beforeAll(async () => {
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

	it('hover: "component" not "function"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 0, 25)('component');
		expect(text).toBe('component HoverDemo(label: string, value: number, "data-id": string, "aria-label": string): any');
	});

	it('hover: "state" not "let"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 6, 8)('state');
		expect(text).toBe('state count: number');
	});

	it('hover: "derived" not "const"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 7, 12)('derived');
		expect(text).toBe('derived doubled: number');
	});

	it('hover: "(prop)" not "(parameter)"', async () => {
		const text = await hoverAt('HoverDemo.tsx', 1, 2)('prop');
		expect(text).toBe('(prop) label: string');
	});

	it('hover: "(binded prop)" for bind param', async () => {
		const text = await hoverAt('HoverDemo.tsx', 2, 7)('binded prop');
		expect(text).toBe('(binded prop) value: number');
	});

	it('hover: "(prop)" for renamed param', async () => {
		const text = await hoverAt('HoverDemo.tsx', 3, 15)('prop');
		expect(text).toBe('(prop) dataId: string');
	});

	it('hover: "(binded prop)" for bind renamed param', async () => {
		const text = await hoverAt('HoverDemo.tsx', 4, 24)('binded prop');
		expect(text).toBe('(binded prop) ariaLabel: string');
	});

	// ── Hover keyword overrides at use sites ─────────────────────

	it('hover use: "(prop)" for prop reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 11, 10)('prop');
		expect(text).toBe('(prop) label: string');
	});

	it('hover use: "state" for state reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 11, 19)('state');
		expect(text).toBe('state count: number');
	});

	it('hover use: "derived" for derived reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 12, 19)('derived');
		expect(text).toBe('derived doubled: number');
	});

	it('hover use: "(binded prop)" for bind param reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 13, 17)('binded prop');
		expect(text).toBe('(binded prop) value: number');
	});

	it('hover use: "(prop)" for renamed param reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 14, 14)('prop');
		expect(text).toBe('(prop) dataId: string');
	});

	it('hover use: "(binded prop)" for bind renamed param reference', async () => {
		const text = await hoverAt('HoverDemo.tsx', 15, 16)('binded prop');
		expect(text).toBe('(binded prop) ariaLabel: string');
	});

	// ── Hover keyword overrides for imports ──────────────────────

	it('hover import: "state" for imported state at declaration', async () => {
		const text = await hoverAt('ImportDemo.tsx', 0, 9)('state');
		expect(text).toBe('(alias) state count: number');
	});

	it('hover import: "derived" for imported derived at declaration', async () => {
		const text = await hoverAt('ImportDemo.tsx', 0, 16)('derived');
		expect(text).toBe('(alias) derived doubled: number');
	});

	it('hover import: "state" for imported state at use site', async () => {
		const text = await hoverAt('ImportDemo.tsx', 5, 10)('state');
		expect(text).toBe('(alias) state count: number');
	});

	it('hover import: "derived" for imported derived at use site', async () => {
		const text = await hoverAt('ImportDemo.tsx', 6, 10)('derived');
		expect(text).toBe('(alias) derived doubled: number');
	});

	// ── Hover for-loop clauses (source map preservation) ─────────

	it('hover: "index" variable in for-loop clause', async () => {
		const text = await hoverAt('ForLoopDemo.tsx', 5, 52)('number');
		expect(text).toBe('let i: number');
	});

	it('hover: "key" expression item in for-loop clause', async () => {
		const text = await hoverAt('ForLoopDemo.tsx', 5, 37)('item');
		expect(text).toBe('const item: {');
	});

	// ── Diagnostics ──────────────────────────────────────────────

	it('unused CSS selector diagnostic', async () => {
		const uri = fixtureUri('UnusedCss.tsx');
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);

		const diags = await waitFor(
			() => Promise.resolve(vscode.languages.getDiagnostics(uri)),
			(d) => d.some(x => x.source === 'dartsx' && x.message.toLowerCase().includes('unused')),
		);

		const unused = diags.filter(d => d.source === 'dartsx' && d.message.toLowerCase().includes('unused'));
		expect(unused.length).toBeGreaterThan(0);
		expect(unused.some(d => d.message.includes('unused-selector'))).toBe(true);
	});

	it('TypeScript type errors pass through', async () => {
		const uri = fixtureUri('TypeError.tsx');
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);

		const diags = await waitFor(
			() => Promise.resolve(vscode.languages.getDiagnostics(uri)),
			(d) => d.some(x => x.severity === vscode.DiagnosticSeverity.Error && x.source === 'ts'),
		);

		const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error && d.source === 'ts');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('component usage infers prop types from declaration', async () => {
		const uri = fixtureUri('PropsInferenceDemo.tsx');
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
		const text = doc.getText();

		const firstUsageOffset = text.indexOf('<Badge title={label} count={total} active={true} />');
		const secondUsageOffset = text.indexOf('<Badge title={123} count={\'bad\'} />');

		const firstUsageLine = doc.positionAt(firstUsageOffset).line;
		const secondUsageLine = doc.positionAt(secondUsageOffset).line;

		const diags = await waitFor(
			() => Promise.resolve(vscode.languages.getDiagnostics(uri)),
			(d) => d.some(x => x.severity === vscode.DiagnosticSeverity.Error && x.source === 'ts'),
		);

		const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error && d.source === 'ts');

		const firstUsageErrors = errors.filter(d => d.range.start.line === firstUsageLine);
		const secondUsageErrors = errors.filter(d => d.range.start.line === secondUsageLine);

		expect(firstUsageErrors.length).toBe(0);
		expect(secondUsageErrors.length).toBe(2);
		expect(secondUsageErrors.every(d => d.message.includes('not assignable to type'))).toBe(true);
	}, 20000);
});
