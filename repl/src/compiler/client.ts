import type { CompileResult } from '../state/store';

export async function compileSource(
	source: string,
	filename: string = 'main.tsx',
	files?: Record<string, string>,
): Promise<CompileResult> {
	const res = await fetch('/__dartsx_compile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ source, filename: filename || 'main.tsx', files }),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		return { code: '', css: '', map: null, error: body.error || 'Compilation failed' };
	}

	const result = await res.json();

	let map = null;
	if (result.map) {
		const { TraceMap } = await import('@jridgewell/trace-mapping');
		map = new TraceMap(result.map);
	}

	return {
		code: result.code || '',
		css: result.css || '',
		map,
		error: null,
	};
}
