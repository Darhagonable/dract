// Preview graph building: rewrite the compiled outputs' relative imports
// into module tokens the sandbox bootstrap resolves to blob URLs. Runs
// inside the compiler worker, where the outputs are born — the main thread
// never parses module code. Specifiers are rewritten back-to-front so
// earlier offsets stay valid; only sibling imports and the dartsx family
// are supported (external packages arrive with type acquisition).

import { init, parse } from 'es-module-lexer';
import type { CompileOutputs, PreviewGraph } from './types';
import { moduleToken } from './types';

const DARTSX_SPECIFIERS = new Set([
	'dartsx',
	'dartsx/internal/client',
	'dartsx/jsx-runtime',
	'dartsx/jsx-dev-runtime',
]);

export type GraphResult = { ok: true; graph: PreviewGraph } | { ok: false; error: string };

const lexerReady = init;

export async function buildGraph(outputs: CompileOutputs, entry: string): Promise<GraphResult> {
	await lexerReady;

	const rewritten = new Map<string, string>();
	for (const [name, output] of Object.entries(outputs)) {
		if (!output.code) continue;
		const [imports] = parse(output.code, name);
		let code = output.code;
		for (let i = imports.length - 1; i >= 0; i--) {
			const record = imports[i];
			const specifier = record.specifier;
			if (!specifier) continue;
			let replacement: string;
			if (specifier.startsWith('./')) {
				const base = specifier.slice(2);
				const target = [base, `${base}.tsx`, `${base}.ts`].find(
					(candidate) => outputs[candidate]?.code,
				);
				if (!target) {
					return { ok: false, error: `Cannot resolve '${specifier}' imported by ${name}` };
				}
				replacement = moduleToken(target);
			} else if (DARTSX_SPECIFIERS.has(specifier)) {
				continue; // bare — resolved by the sandbox import map
			} else if (specifier.startsWith('dartsx/')) {
				return { ok: false, error: `Unsupported dartsx import '${specifier}' in ${name}` };
			} else if (specifier.startsWith('../') || specifier.startsWith('/')) {
				return { ok: false, error: `Only sibling imports are supported ('${specifier}' in ${name})` };
			} else {
				return { ok: false, error: `External package '${specifier}' is not supported yet (${name})` };
			}
			if (record.type === 'dynamic') replacement = JSON.stringify(replacement);
			code = code.slice(0, record.start) + replacement + code.slice(record.end);
		}
		rewritten.set(name, code);
	}

	if (!rewritten.has(entry)) {
		return { ok: false, error: `Entry ${entry} has no compiled output` };
	}

	return {
		ok: true,
		graph: {
			entry,
			modules: [...rewritten.entries()].map(([name, code]) => ({ name, code })),
		},
	};
}
