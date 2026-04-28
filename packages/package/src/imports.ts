/**
 * Import path utilities
 *
 * Rewrites .ts/.tsx import extensions to .js/.jsx in output files,
 * and handles DarTsx file import rewriting.
 */

/**
 * Rewrite relative imports in generated code.
 * This ensures imports resolve correctly in the published package.
 *
 * - .ts → .js
 * - .tsx (non-DarTsx) → .jsx
 * - .tsx (DarTsx) → kept as .tsx (consumer compiles)
 * - extensionless → add .js or .tsx based on what the target file is
 */
export function rewriteImportExtensions(
	content: string,
	dartsxFiles: Set<string>,
	currentFile: string,
	allFiles: Set<string>,
): string {
	return adjustImports(content, (importPath) => {
		if (!importPath.startsWith('.')) return importPath;

		if (importPath.endsWith('.ts')) {
			return importPath.slice(0, -3) + '.js';
		}

		if (importPath.endsWith('.tsx')) {
			const resolved = resolveRelative(currentFile, importPath);
			if (dartsxFiles.has(resolved)) {
				return importPath;
			}
			return importPath.slice(0, -4) + '.jsx';
		}

		// Extensionless relative imports — resolve against known files
		if (!/\.\w+$/.test(importPath)) {
			const resolved = resolveRelative(currentFile, importPath);
			// Check if target is a DarTsx file (.tsx that we ship as source)
			if (dartsxFiles.has(resolved + '.tsx')) {
				return importPath + '.tsx';
			}
			// Check if target is a .ts file (becomes .js)
			if (allFiles.has(resolved + '.ts')) {
				return importPath + '.js';
			}
			// Check if target is a .tsx file (non-DarTsx, becomes .jsx)
			if (allFiles.has(resolved + '.tsx')) {
				return importPath + '.jsx';
			}
			// Check for index files
			if (allFiles.has(resolved + '/index.ts')) {
				return importPath + '/index.js';
			}
			if (dartsxFiles.has(resolved + '/index.tsx')) {
				return importPath + '/index.tsx';
			}
			if (allFiles.has(resolved + '/index.tsx')) {
				return importPath + '/index.jsx';
			}
		}

		return importPath;
	});
}

function resolveRelative(from: string, to: string): string {
	const fromDir = from.includes('/') ? from.replace(/\/[^/]*$/, '') : '';
	const parts = fromDir ? fromDir.split('/') : [];
	for (const seg of to.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.') parts.push(seg);
	}
	return parts.join('/');
}

function adjustImports(content: string, adjust: (path: string) => string): string {
	const replaceImportPath = (match: string, quote: string, importPath: string) => {
		const adjusted = adjust(importPath);
		if (adjusted !== importPath) {
			return match.replace(quote + importPath + quote, quote + adjusted + quote);
		}
		return match;
	};

	// import/export { ... } from '...'
	content = content.replace(
		/\b(?:import|export)(?:\s+type)?(?:(?:\s+[\w$]+\s+)|(?:(?:\s+[\w$]+\s*,\s*)?\s*\{[^}]*\}\s*))from\s*(['"])([^'";]+)\1/g,
		(match, quote, importPath) => replaceImportPath(match, quote, importPath),
	);

	// import/export * as x from '...'
	content = content.replace(
		/\b(?:import|export)(?:\s+type)?\s*\*\s*as\s+[\w$]+\s+from\s*(['"])([^'";]+)\1/g,
		(match, quote, importPath) => replaceImportPath(match, quote, importPath),
	);

	// export * from '...'
	content = content.replace(
		/\b(?:export)(?:\s+type)?\s*\*\s*from\s*(['"])([^'";]+)\1/g,
		(match, quote, importPath) => replaceImportPath(match, quote, importPath),
	);

	// import('...')
	content = content.replace(
		/\bimport\s*\(\s*(['"])([^'";]+)\1\s*\)/g,
		(match, quote, importPath) => replaceImportPath(match, quote, importPath),
	);

	// import '...'
	content = content.replace(
		/\bimport\s+(['"])([^'";]+)\1/g,
		(match, quote, importPath) => replaceImportPath(match, quote, importPath),
	);

	return content;
}
