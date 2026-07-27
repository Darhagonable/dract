import type { SourceMap } from '@jridgewell/trace-mapping';

export interface ReplFile {
	source: string;
}

export interface CompileResult {
	code: string;
	css: string;
	map: SourceMap | null;
	error: string | null;
}

export const files: Record<string, string> = {};
export let activeFile = 'main.tsx';
export let compileResult: CompileResult = { code: '', css: '', map: null, error: null };
export let isCompiling = false;
export let errorLog: string[] = [];

const listeners: Set<() => void> = new Set();

export function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function notify() {
	for (const fn of listeners) fn();
}

export function setFiles(newFiles: Record<string, string>) {
	Object.assign(files, newFiles);
	notify();
}

export function setFile(name: string, source: string) {
	files[name] = source;
	notify();
}

export function removeFile(name: string) {
	delete files[name];
	if (activeFile === name) {
		activeFile = Object.keys(files)[0] || 'main.tsx';
	}
	notify();
}

export function setActiveFile(name: string) {
	activeFile = name;
	notify();
}

export function setCompileResult(result: CompileResult) {
	compileResult = result;
	isCompiling = false;
	notify();
}

export function setCompiling(compiling: boolean) {
	isCompiling = compiling;
	notify();
}

export function setErrorLog(errors: string[]) {
	errorLog = errors;
	notify();
}

export function getFileNames(): string[] {
	return Object.keys(files);
}

export function getSource(): string {
	return files[activeFile] || '';
}
