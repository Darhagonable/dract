import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';

async function openFixture(file: string) {
	const uri = vscode.Uri.file(import.meta.dirname! + '/fixture/' + file);
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc);
	return doc;
}

async function hoverAt(doc: vscode.TextDocument, line: number, col: number): Promise<string> {
	return vi.waitUntil(async () => {
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider', doc.uri, new vscode.Position(line, col),
		);
		if (!hovers.length) return;
		const c = hovers[0].contents[0];
		const text = typeof c === 'string' ? c : c.value;
		if (text.includes('(loading...)')) return;
		const m = text.match(/```typescript\n([\s\S]*)\n```/);
		return m ? m[1] : text;
	}, { timeout: 15000 });
}

describe('VSCode Extension', () => {
	it('extension activates', async () => {
		const ext = vscode.extensions.getExtension('dartsx.dartsx-vscode');
		expect(ext).toBeDefined();
		await ext!.activate();
		expect(ext!.isActive).toBe(true);
	});
});

describe('Hover keyword overrides', async () => {
	const doc = await openFixture('src/HoverDemo.tsx');

	it('hover: "component" not "function"', async () => {
		const text = await hoverAt(doc, 0, 25);
		expect(text).toBe('component HoverDemo(label: string, value: number, "data-id": string, "aria-label": string): any');
	});

	it('hover: "state" not "let"', async () => {
		const text = await hoverAt(doc, 6, 8);
		expect(text).toBe('state count: number');
	});

	it('hover: "derived" not "const"', async () => {
		const text = await hoverAt(doc, 7, 12);
		expect(text).toBe('derived doubled: number');
	});

	it('hover: "(prop)" not "(parameter)"', async () => {
		const text = await hoverAt(doc, 1, 2);
		expect(text).toBe('(prop) label: string');
	});

	it('hover: "(binded prop)" for bind param', async () => {
		const text = await hoverAt(doc, 2, 7);
		expect(text).toBe('(binded prop) value: number');
	});

	it('hover: "(prop)" for renamed param', async () => {
		const text = await hoverAt(doc, 3, 15);
		expect(text).toBe('(prop) dataId: string');
	});

	it('hover: "(binded prop)" for bind renamed param', async () => {
		const text = await hoverAt(doc, 4, 24);
		expect(text).toBe('(binded prop) ariaLabel: string');
	});

	// ── Hover keyword overrides at use sites ─────────────────────

	it('hover use: "(prop)" for prop reference', async () => {
		const text = await hoverAt(doc, 11, 10);
		expect(text).toBe('(prop) label: string');
	});

	it('hover use: "state" for state reference', async () => {
		const text = await hoverAt(doc, 11, 19);
		expect(text).toBe('state count: number');
	});

	it('hover use: "derived" for derived reference', async () => {
		const text = await hoverAt(doc, 12, 19);
		expect(text).toBe('derived doubled: number');
	});

	it('hover use: "(binded prop)" for bind param reference', async () => {
		const text = await hoverAt(doc, 13, 17);
		expect(text).toBe('(binded prop) value: number');
	});

	it('hover use: "(prop)" for renamed param reference', async () => {
		const text = await hoverAt(doc, 14, 14);
		expect(text).toBe('(prop) dataId: string');
	});

	it('hover use: "(binded prop)" for bind renamed param reference', async () => {
		const text = await hoverAt(doc, 15, 16);
		expect(text).toBe('(binded prop) ariaLabel: string');
	});
});

describe('Hover keyword overrides for imports', async () => {
	const doc = await openFixture('src/ImportDemo.tsx');

	it('hover import: "state" for imported state at declaration', async () => {
		const text = await hoverAt(doc, 0, 9);
		expect(text).toBe(`(alias) state count: number
import count`);
	});

	it('hover import: "derived" for imported derived at declaration', async () => {
		const text = await hoverAt(doc, 0, 16);
		expect(text).toBe(`(alias) derived doubled: number
import doubled`);
	});

	it('hover import: "state" for imported state at use site', async () => {
		const text = await hoverAt(doc, 5, 10);
		expect(text).toBe(`(alias) state count: number
import count`);
	});

	it('hover import: "derived" for imported derived at use site', async () => {
		const text = await hoverAt(doc, 6, 10);
		expect(text).toBe(`(alias) derived doubled: number
import doubled`);
	});
});

describe('Hover for-loop clauses', async () => {
	const doc = await openFixture('src/ForLoopDemo.tsx');

	it('hover: "index" variable in for-loop clause', async () => {
		const text = await hoverAt(doc, 5, 52);
		expect(text).toBe('let i: number');
	});

	it('hover: "key" expression item in for-loop clause', async () => {
		const text = await hoverAt(doc, 5, 37);
		expect(text).toBe(`const item: {
    id: number;
    name: string;
}`);
	});
});

describe('Diagnostics', () => {
	it('unused CSS selector diagnostic', async () => {
		const doc = await openFixture('src/UnusedCss.tsx');

		const diags = await vi.waitUntil(async () => {
			const d = vscode.languages.getDiagnostics(doc.uri);
			return d.some(x => x.source === 'dartsx' && x.message.toLowerCase().includes('unused')) ? d : undefined;
		});

		const unused = diags.filter(d => d.source === 'dartsx' && d.message.toLowerCase().includes('unused'));
		expect(unused.length).toBeGreaterThan(0);
		expect(unused.some(d => d.message.includes('unused-selector'))).toBe(true);
	});

	it('TypeScript type errors pass through', async () => {
		const doc = await openFixture('src/TypeError.tsx');

		const diags = await vi.waitUntil(async () => {
			const d = vscode.languages.getDiagnostics(doc.uri);
			return d.some(x => x.severity === vscode.DiagnosticSeverity.Error && x.source === 'ts') ? d : undefined;
		});

		const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error && d.source === 'ts');
		expect(errors.length).toBeGreaterThan(0);
	});

	it('component usage infers prop types from declaration', async () => {
		const doc = await openFixture('src/PropsInferenceDemo.tsx');
		const text = doc.getText();

		const firstUsageOffset = text.indexOf('<Badge title={label} count={total} active={true} />');
		const secondUsageOffset = text.indexOf('<Badge title={123} count={\'bad\'} />');

		const firstUsageLine = doc.positionAt(firstUsageOffset).line;
		const secondUsageLine = doc.positionAt(secondUsageOffset).line;

		const diags = await vi.waitUntil(async () => {
			const d = vscode.languages.getDiagnostics(doc.uri);
			return d.some(x => x.severity === vscode.DiagnosticSeverity.Error && x.source === 'ts') ? d : undefined;
		});

		const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error && d.source === 'ts');

		const firstUsageErrors = errors.filter(d => d.range.start.line === firstUsageLine);
		const secondUsageErrors = errors.filter(d => d.range.start.line === secondUsageLine);

		expect(firstUsageErrors.length).toBe(0);
		expect(secondUsageErrors.length).toBe(2);
		expect(secondUsageErrors.every(d => d.message.includes('not assignable to type'))).toBe(true);
	});
});
