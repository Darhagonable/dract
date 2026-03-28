import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compile } from '../../src/compiler';
import $ from '../../src/runtime/internal/client';
import * as _dartsx_ from '../../src/runtime/external';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Compile a .tsx source string and return the compiled code
 * @param {string} source
 * @returns {string}
 */
function compile_dartsx(source) {
	const result = compile(source);
	return result.code;
}

/**
 * Compile and instantiate a module, returning its exports
 * @param {string} code - Compiled JavaScript code
 * @param {Record<string, Record<string, any>>} localModules - Local module exports
 * @returns {Record<string, any>}
 */
function instantiate_module(code, localModules = {}) {
	// Collect local import mappings
	const localImports = [];
	const localImportRe = /import\s+\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g;
	let m;
	while ((m = localImportRe.exec(code)) !== null) {
		const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
		const modulePath = m[2];
		localImports.push({ names, modulePath });
	}

	// Strip ALL import statements
	let transformed = code.replace(
		/import\s+.*?\s+from\s+['"][^'"]+['"];?\n?/g,
		'',
	);

	// Convert export declarations to non-exported
	const exportedNames = [];
	const exportDefaultFnMatch = code.match(/export default function (\w+)/);
	if (exportDefaultFnMatch) {
		exportedNames.push(exportDefaultFnMatch[1]);
		transformed = transformed.replace(/export default function (\w+)/, 'function $1');
	}
	const exportFnMatches = code.matchAll(/export function (\w+)/g);
	for (const efm of exportFnMatches) exportedNames.push(efm[1]);
	const exportVarMatches = code.matchAll(/export (?:var|const|let) (\w+)/g);
	for (const evm of exportVarMatches) exportedNames.push(evm[1]);

	transformed = transformed.replace(/export function (\w+)/g, (_, name) => `function ${name}`);
	transformed = transformed.replace(/export var (\w+)/g, (_, name) => `var ${name}`);
	transformed = transformed.replace(/export const (\w+)/g, (_, name) => `const ${name}`);
	transformed = transformed.replace(/export let (\w+)/g, (_, name) => `let ${name}`);

	const returnExpr = exportedNames.length
		? `return { ${exportedNames.map((n) => `${n}: ${n}`).join(', ')} };`
		: 'return {};';

	// Destructure dartsx external exports (effect, onMount, onDestroy, etc.)
	const dartsxNames = Object.keys(_dartsx_);
	const dartsxDestructure = dartsxNames.length
		? `var { ${dartsxNames.join(', ')} } = __dartsx__;\n`
		: '';

	// Build local module destructuring
	let localDestructure = '';
	for (const { names, modulePath } of localImports) {
		const mod = localModules[modulePath];
		if (mod) {
			for (const name of names) {
				localDestructure += `var ${name} = __locals__[${JSON.stringify(modulePath)}][${JSON.stringify(name)}];\n`;
			}
		}
	}

	const fn = new Function('$', '__dartsx__', '__locals__', `${dartsxDestructure}${localDestructure}${transformed}\n${returnExpr}`);
	return fn($, _dartsx_, localModules);
}

/**
 * Compile all .tsx files in a test directory and return instantiated modules
 * @param {string} directory
 * @returns {{ main: Record<string, any>, modules: Record<string, Record<string, any>> }}
 */
function compile_and_instantiate(directory) {
	const dirPath = join(__dirname, directory);
	const allFiles = readdirSync(dirPath).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
	const compiledModules = {};
	const localModules = {};

	// First compile non-main files (dependencies)
	for (const file of allFiles) {
		if (file === 'main.tsx') continue;
		const filePath = join(dirPath, file);
		const source = readFileSync(filePath, 'utf-8');
		const code = compile_dartsx(source);
		const mod = instantiate_module(code);
		const key = './' + file.replace(/\.(tsx|ts)$/, '');
		compiledModules[file] = mod;
		localModules[key] = mod;
	}

	// Then compile main.tsx with local modules available
	const mainPath = join(dirPath, 'main.tsx');
	if (existsSync(mainPath)) {
		const source = readFileSync(mainPath, 'utf-8');
		const code = compile_dartsx(source);
		compiledModules['main.tsx'] = instantiate_module(code, localModules);
	}

	return { main: compiledModules['main.tsx'] || {}, modules: compiledModules };
}

/**
 * Normalize HTML by stripping comment nodes and normalizing whitespace
 * @param {string} html
 * @returns {string}
 */
function normalizeHtml(html) {
	if (typeof html !== 'string') html = String(html ?? '');
	return html
		.replace(/<!--.*?-->/g, '')       // strip comments
		.replace(/>\s+</g, '><')          // strip whitespace between tags
		.replace(/\s+/g, ' ')             // normalize internal whitespace
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&')
		.trim();
}

/**
 * Create a test suite from a directory
 * @param {string} directory
 */
export function create_test_suite(directory) {
	const testDir = join(__dirname, directory);
	const configPath = join(testDir, '_config.js');

	if (!existsSync(configPath)) {
		return;
	}

	const featureName = directory.replace(/^\.\//, '');

	describe(featureName, async () => {
		const config = (await import(configPath)).default;

		/** @type {HTMLElement} */
		let target;

		beforeEach(() => {
			target = document.createElement('div');
			document.body.appendChild(target);
		});

		afterEach(() => {
			if (target && target.parentNode) {
				target.parentNode.removeChild(target);
			}
		});

		if (config.html !== undefined) {
			it('should render correct HTML', async () => {
				const { main } = compile_and_instantiate(directory);

				// Find the exported component (first export)
				const componentName = Object.keys(main)[0];
				const component = main[componentName];

				if (!component) {
					throw new Error(`No exported component found in ${directory}/main.tsx`);
				}

				_dartsx_.mount(component, target);

				// Allow microtasks to flush
				await new Promise((r) => queueMicrotask(r));

				const actual = normalizeHtml(target.innerHTML);
				const expected = normalizeHtml(config.html);

				expect(actual).toBe(expected);
			});
		}

		if (config.test) {
			it('should pass interaction test', async () => {
				const { main } = compile_and_instantiate(directory);

				const componentName = Object.keys(main)[0];
				const component = main[componentName];

				if (!component) {
					throw new Error(`No exported component found in ${directory}/main.tsx`);
				}

				_dartsx_.mount(component, target);

				// Allow microtasks to flush
				await new Promise((r) => queueMicrotask(r));

				await config.test({
					assert: {
						htmlEqual: (actual, expected) => {
							expect(normalizeHtml(String(actual))).toBe(normalizeHtml(String(expected)));
						},
					},
					target,
					flush: async () => {
						await new Promise((r) => queueMicrotask(r));
					},
				});
			});
		}
	});
}

export { compile_and_instantiate, compile_dartsx };
