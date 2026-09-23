// DarTsx compiler worker: the real dartsx/compiler Project over the
// playground's virtual file set, off the main thread — the oxc wasm
// toolchain is multi-megabyte and compilation must never block typing.
//
// One message type: { type: 'compile', id, entry, files } →
// { type: 'result', id, outputs, graph, graphError }. The Project lives for
// the page; compilation is update-driven (no entryPoints/init) — the whole
// file set is pushed through update(), iterating Project's invalidated sets
// until they converge: a module's inputs (a caller's reactive-call
// contributions, an importer's reactive exports) can change under it
// mid-pass, so a first output can be stale until the loop settles.
//
// compileModule throws on invalid input (parse/strip failures); errors are
// caught per file and reported — the output pane shows errors, never stale
// code. A file that errors stops its own invalidation flow for that pass;
// the next successful compile re-converges the graph. When the run is
// clean, the preview module graph (see graph.ts) is built here too — the
// outputs never cross the wire twice.

import { Project } from 'dartsx/compiler';
import { buildGraph } from './graph';
import type { CompileOutputs, CompileResult, CompilerFile } from './types';

interface CompileRequest {
	type: 'compile';
	id: number;
	entry: string;
	files: CompilerFile[];
}

const TSCONFIG_FILE = 'tsconfig.json';

const currentFiles = new Map<string, string>();

const project = new Project({
	css: 'injected',
	entryPoints: [],
	host: {
		resolve(specifier: string) {
			if (!specifier.startsWith('./')) return undefined;
			const base = specifier.slice(2);
			for (const candidate of [base, `${base}.tsx`, `${base}.ts`]) {
				if (currentFiles.has(candidate)) return candidate;
			}
			return undefined;
		},
		readFile(id: string) {
			return currentFiles.get(id);
		},
	},
});

async function compile(files: CompilerFile[]): Promise<CompileOutputs> {
	const names = new Set(files.filter((file) => file.name !== TSCONFIG_FILE).map((file) => file.name));

	for (const known of project.modules()) {
		if (!names.has(known)) project.remove(known);
	}

	currentFiles.clear();
	for (const name of names) {
		currentFiles.set(name, files.find((file) => file.name === name)!.source);
	}

	const errors = new Map<string, string>();
	let worklist = [...names];
	while (worklist.length > 0) {
		const next: string[] = [];
		for (const name of worklist) {
			try {
				const { invalidated } = await project.update(name, currentFiles.get(name)!);
				for (const id of invalidated) {
					if (names.has(id) && !next.includes(id)) next.push(id);
				}
			} catch (error) {
				errors.set(name, error instanceof Error ? error.message : String(error));
			}
		}
		worklist = next;
	}

	const outputs: CompileOutputs = {};
	for (const name of names) {
		const error = errors.get(name);
		if (error !== undefined) {
			outputs[name] = { code: null, error };
			continue;
		}
		const output = project.output(name);
		outputs[name] = output ? { code: output.js.code, error: null } : { code: null, error: null };
	}
	return outputs;
}

async function run(files: CompilerFile[], entry: string): Promise<CompileResult> {
	const outputs = await compile(files);
	if (Object.values(outputs).some((result) => result.error)) {
		return { outputs, graph: null, graphError: null };
	}
	const graph = await buildGraph(outputs, entry);
	return graph.ok
		? { outputs, graph: graph.graph, graphError: null }
		: { outputs, graph: null, graphError: graph.error };
}

self.onmessage = async (event: MessageEvent<CompileRequest>) => {
	const data = event.data;
	if (data?.type !== 'compile') return;
	let result: CompileResult;
	try {
		result = await run(data.files, data.entry);
	} catch (error) {
		// A fatal failure (e.g. a broken runtime dependency) must still
		// answer — every file reports it so the pane never hangs.
		const fatal = error instanceof Error ? error.message : String(error);
		const outputs: CompileOutputs = {};
		for (const file of data.files) {
			if (file.name !== TSCONFIG_FILE) outputs[file.name] = { code: null, error: fatal };
		}
		result = { outputs, graph: null, graphError: null };
	}
	(self as unknown as Worker).postMessage({ type: 'result', id: data.id, ...result });
};

// Boot signal: the main thread gates the first compile on it. A message
// posted before the module graph (and the oxc wasm runtime it carries) has
// finished evaluating can be lost — the same race the language worker's
// 'dartsx-ready' gate solves.
(self as unknown as Worker).postMessage({ type: 'ready' });
