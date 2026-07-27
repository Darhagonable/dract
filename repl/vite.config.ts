import { defineConfig } from 'vite';
import dartsx from 'dartsx-vite-plugin';
import { compile } from 'dartsx/compiler';


function bundleCompiledFiles(
	entryName: string,
	compiled: Record<string, { code: string; css: string }>,
	files: Record<string, string>,
): { code: string; css: string } {
	const allCss = Object.values(compiled).map(c => c.css).filter(Boolean).join('\n\n');
	const entryCode = compiled[entryName]?.code || '';
	if (!entryCode) return { code: '', css: allCss };

	let code = entryCode;

	for (const fname of Object.keys(files)) {
		if (fname === entryName) continue;
		const depCode = compiled[fname]?.code;
		if (!depCode) continue;

		const nameNoExt = fname.replace(/\.(tsx?|jsx?)$/, '');
		const importRe = new RegExp(`import\\s+(\\w+(?:\\s*,\\s*\\{[^}]*\\})?)\\s+from\\s+['"]\\.\\/${nameNoExt}['"]`);

		const hasDefaultExport = /export\s+default\s+/.test(depCode);
		const depClean = depCode
			.replace(/import\s+.*?from\s+['"]dartsx(\/[^'"]+)?['"];/g, '')
			.replace(/export\s+default\s+(\w+)/g, 'const __repl_default_$1 = $1')
			.replace(/export\s+function\s+(\w+)/g, 'function $1')
			.replace(/export\s+const\s+(\w+)/g, 'const $1')
			.replace(/export\s*\{[^}]*\}/g, '');

		code = code.replace(
			importRe,
			(_, imported) => {
				const isDefault = !imported.includes('{');
				if (isDefault && hasDefaultExport) {
					const varName = imported.trim();
					return `${depClean}\nconst ${varName} = __repl_default_${varName};`;
				}
				return depClean;
			},
		);
	}

	return { code, css: allCss };
}

export default defineConfig({
	plugins: [
		dartsx(),
		{
			name: 'dartsx-repl-compile',
			configureServer(server) {
				server.middlewares.use('/__dartsx_compile', async (req, res) => {
					if (req.method !== 'POST') {
						res.statusCode = 405;
						res.setHeader('Content-Type', 'application/json');
						res.end(JSON.stringify({ error: 'Method not allowed' }));
						return;
					}
					let body = '';
					req.on('data', (chunk: string) => (body += chunk));
					req.on('end', () => {
						try {
							const { source, filename = 'main.tsx', files } = JSON.parse(body);
							const reactiveImports: Record<string, string[]> = {};
							const allCompiled: Record<string, { code: string; css: string }> = {};

							if (files && typeof files === 'object') {
								for (const [name, content] of Object.entries(files) as [string, string][]) {
									if (typeof content !== 'string') continue;
									if (name !== filename) {
										try {
											const depResult = compile(content, { filename: name });
											allCompiled[name] = { code: depResult.code, css: depResult.css };
											const specifier = './' + name.replace(/\.(tsx?|jsx?)$/, '');
											if (depResult.reactiveExports.length > 0) {
												reactiveImports[specifier] = depResult.reactiveExports;
											}
										} catch {}
									}
								}
							}

							try {
								const result = compile(source, { filename, reactiveImports });
								allCompiled[filename] = { code: result.code, css: result.css };

								res.setHeader('Content-Type', 'application/json');
								if (Object.keys(allCompiled).length > 1) {
									const bundled = bundleCompiledFiles(filename, allCompiled, files || {});
									res.end(JSON.stringify({ ...result, code: bundled.code, css: bundled.css }));
								} else {
									res.end(JSON.stringify({ ...result, error: null }));
								}
							} catch (e: any) {
								res.setHeader('Content-Type', 'application/json');
								res.end(JSON.stringify({ error: e.message }));
							}
						} catch (e: any) {
							res.statusCode = 400;
							res.setHeader('Content-Type', 'application/json');
							res.end(JSON.stringify({ error: e.message }));
						}
					});
				});
			},
		},
	],
	resolve: {
		conditions: ['import', 'module', 'browser', 'default'],
	},
	optimizeDeps: {
		include: ['monaco-editor', '@jridgewell/trace-mapping', 'lz-string'],
	},
});
