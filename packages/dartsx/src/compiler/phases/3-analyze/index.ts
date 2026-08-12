/**
 * Phase 3 — Analyze
 *
 * Walks the OXC AST (already parsed) and builds metadata for the transform:
 * - Scope tree (via create_scopes)
 * - Component identification
 * - Binding kind upgrades (state/derived markers → binding.kind)
 * - Transform records on bindings (read/assign/update)
 * - Style block association
 * - Cross-file reactive import tracking
 * - Call-site analysis for reactive params
 *
 * Does NOT build any JSX IR. The transform walks the OXC AST directly
 * with zimmerframe visitors.
 */
import type { ComponentMeta, PreprocessResult } from '../1-preprocess';
import { STATE_MARKER, DERIVED_MARKER } from '../1-preprocess';
import {
	Scope,
	ScopeRoot,
	create_scopes,
} from '../../scope';
import type { AstNode } from '../../builders';
import type {
	Program,
	Statement,
	Directive,
	Expression,
	Argument,
	FunctionBody,
	ParamPattern,
	Function as OxcFunction,
	VariableDeclaration,
	JSXElement,
	JSXFragment,
} from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

/** Runtime type guard: checks that a value is a span-bearing AST node */
function isAstNode(value: unknown): value is AstNode {
	return (
		value !== null &&
		typeof value === 'object' &&
		'type' in value &&
		typeof value.type === 'string' &&
		'start' in value &&
		'end' in value
	);
}

export interface StyleBlockIR {
	css: string;
	isGlobal: boolean;
	scopePath: number[];
	index: number;
}

export interface ComponentInfo {
	meta: ComponentMeta;
	/** The FunctionDeclaration (or ExportNamedDeclaration wrapping it) AST node */
	node: AstNode;
	/** The function's body AST node */
	bodyNode: FunctionBody | null;
	/** Per-component rename map (localName → externalName) */
	renamedParams: Record<string, string>;
	/** Local names that are bind props */
	bindParams: string[];
	/** Style blocks for this component */
	styleBlocks: StyleBlockIR[];
	/** Component's own scope (child of module scope, created by create_scopes) */
	scope: Scope;
}

export interface AnalysisResult {
	/** The OXC AST (unmodified, to be walked by transform) */
	ast: Program;
	/** Original source text */
	source: string;
	/** Module-level scope */
	scope: Scope;
	/** Scope root (for unique name generation) */
	root: ScopeRoot;
	/** Map from AST nodes to their scopes (for zimmerframe _ visitor) */
	scopes: Map<AstNode, Scope>;
	/** Component metadata keyed by AST node */
	components: Map<AstNode, ComponentInfo>;
	/** Set of component function names */
	componentNames: Set<string>;
	/** Style blocks keyed by component AST node */
	styles: Map<AstNode, StyleBlockIR[]>;
	/** Names of reactive exports (state + derived) for cross-file tracking */
	reactiveExports: string[];
	/**
	 * Cross-file reactive function calls detected at call sites.
	 * Maps import specifier → { exportedName → reactive param indices }.
	 */
	reactiveCalls: Record<string, Record<string, number[]>>;
	/**
	 * Maps callable function names to their reactive param indices.
	 * Used to suppress $.get() unwrapping on call arguments.
	 */
	reactiveCallTargets: Map<string, Set<number>>;
	/** Import specifiers found in this module */
	importSpecifiers: string[];
	/** Preprocessor result (for downstream use) */
	preprocessed: PreprocessResult;
}

// ── Analyze ────────────────────────────────────────────────────────

export function analyze(
	ast: Program,
	source: string,
	meta: PreprocessResult,
	reactiveImports?: Record<string, string[]>,
	reactiveCallImports?: Record<string, number[]>,
): AnalysisResult {
	const componentNames = new Set(meta.components.map((c) => c.name));
	const stateSet = new Set(meta.stateVars);
	const derivedSet = new Set(meta.derivedVars);

	// 1. Build scope tree
	const root = new ScopeRoot();
	const { scope: moduleScope, scopes } = create_scopes(ast, source, root);

	// 2. Upgrade binding kinds based on markers
	upgradeBindingKinds(ast, scopes, stateSet, derivedSet, componentNames, meta);

	// 3. Mark cross-file reactive imports
	if (reactiveImports) {
		markCrossFileReactiveImports(ast, moduleScope, reactiveImports);
	}

	// 4. Identify components and associate metadata
	const components = new Map<AstNode, ComponentInfo>();
	const styles = new Map<AstNode, StyleBlockIR[]>();
	const reactiveExports: string[] = [];
	const importSpecifiers: string[] = [];

	/** Maps function names to ordered param name lists (for call-site analysis) */
	const functionParamMap = new Map<string, string[]>();
	/** Maps imported local names to their source specifier and exported name */
	const importSourceMap = new Map<string, { specifier: string; exportedName: string }>();

	/** Recursively find component function declarations at any nesting level */
	function findComponents(node: AstNode): void {
		const fn = extractFunctionDecl(node);
		if (fn && componentNames.has(fn.name)) {
			const compMeta = meta.components.find((c) => c.name === fn.name)!;
			const jsxRoot = findReturnJSXRoot(fn.node);
			const compStyleBlocks = (meta.styleBlocks || []).filter(
				(sb) => jsxRoot ? findJSXMarkerElement(jsxRoot, sb.markerName) !== null : false,
			);

			const fnNode = fn.node;
			const compScope = scopes.get(fnNode) || moduleScope;

			upgradeComponentParams(fnNode, compScope, meta.renamedParams[compMeta.name] || {}, meta.bindParams?.[compMeta.name] || []);

			const styleBlockIRs: StyleBlockIR[] = compStyleBlocks.map((sb, index) => ({
				css: sb.css,
				isGlobal: sb.isGlobal,
				scopePath: jsxRoot ? computeStyleBlockScopePath(jsxRoot, sb.markerName) : [],
				index,
			}));

			const info: ComponentInfo = {
				meta: compMeta,
				node,
				bodyNode: fn.body,
				renamedParams: meta.renamedParams[compMeta.name] || {},
				bindParams: meta.bindParams?.[compMeta.name] || [],
				styleBlocks: styleBlockIRs,
				scope: compScope,
			};

			components.set(node, info);
			styles.set(node, styleBlockIRs);
		}

		// Recurse into function bodies to find nested components
		if (fn && fn.body) {
			for (const stmt of fn.body.body) {
				findComponents(stmt);
			}
			return;
		}

		// Recurse into other nested structures (e.g. describe(() => { it(() => { component ... }) }))
		if (node.type === 'ExpressionStatement') {
			findComponents(node.expression);
		} else if (node.type === 'CallExpression') {
			for (const arg of node.arguments) {
				findComponents(arg);
			}
		} else if (node.type === 'ArrowFunctionExpression') {
			if (node.body.type === 'BlockStatement') {
				for (const stmt of node.body.body) {
					findComponents(stmt);
				}
			}
		} else if (node.type === 'FunctionExpression') {
			if (node.body) {
				for (const stmt of node.body.body) {
					findComponents(stmt);
				}
			}
		}
	}

	for (const node of ast.body) {
		// Collect import specifiers and source mappings
		if (node.type === 'ImportDeclaration') {
			const src = node.source.value;
			if (src && !src.startsWith('dartsx/internal')) {
				importSpecifiers.push(src);
			}
			if (src) {
				for (const spec of node.specifiers) {
					if (spec.type === 'ImportSpecifier') {
						const importedName = spec.imported.type === 'Identifier'
							? spec.imported.name
							: spec.imported.value;
						const localName = spec.local.name;
						importSourceMap.set(localName, { specifier: src, exportedName: importedName });
					}
				}
			}
			continue;
		}

		// Identify component function declarations (including nested)
		findComponents(node);

		// Collect function param maps for call-site analysis
		const fn = extractFunctionDecl(node);
		if (fn && !componentNames.has(fn.name)) {
			const paramNames = fn.params
				.map((p) => {
					if (p.type === 'Identifier') return p.name;
					if (p.type === 'RestElement') {
						return p.argument.type === 'Identifier' ? p.argument.name : undefined;
					}
					if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
						return p.left.name;
					}
					return undefined;
				})
				.filter((name): name is string => name !== undefined);
			functionParamMap.set(fn.name, paramNames);
		}

		// Track reactive exports
		if (node.type === 'ExportNamedDeclaration' || node.type === 'VariableDeclaration') {
			const varDecl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
			const exported = node.type === 'ExportNamedDeclaration';
			if (exported && varDecl?.type === 'VariableDeclaration') {
				for (const decl of varDecl.declarations) {
					if (decl.id.type !== 'Identifier') continue;
					const name = decl.id.name;
					if (!name) continue;
					const binding = moduleScope.get(name);
					if (binding && (binding.kind === 'state' || binding.kind === 'derived')) {
						binding.exported = true;
						reactiveExports.push(name);
					}
				}
			}
		}
	}

	// 5. Call-site analysis for reactive params
	const implicitReactiveParams = new Map<string, Set<string>>();
	const importedReactiveCalls: Record<string, Record<string, Set<number>>> = {};

	walkCallSites(
		ast, source, moduleScope, scopes, stateSet, derivedSet,
		componentNames, functionParamMap, implicitReactiveParams,
		importSourceMap, importedReactiveCalls,
	);

	// Second-pass: re-scan function bodies where params became reactive
	for (const node of ast.body) {
		const fn = extractFunctionDecl(node);
		if (!fn || componentNames.has(fn.name)) continue;

		const sameFileReactive = implicitReactiveParams.get(fn.name);
		const crossFileIndices = reactiveCallImports?.[fn.name];
		if (!sameFileReactive && !crossFileIndices) continue;

		const paramNames = functionParamMap.get(fn.name) || [];
		const fnScope = scopes.get(fn.node) || moduleScope;

		// Upgrade reactive params in scope
		if (sameFileReactive) {
			for (const paramName of sameFileReactive) {
				const binding = fnScope.get(paramName);
				if (binding && binding.kind === 'normal') {
					binding.kind = 'prop'; // treat as reactive param
				}
			}
		}
		if (crossFileIndices) {
			for (const idx of crossFileIndices) {
				if (idx < paramNames.length) {
					const binding = fnScope.get(paramNames[idx]);
					if (binding && binding.kind === 'normal') {
						binding.kind = 'prop';
					}
				}
			}
		}

		// Re-walk for forwarded calls
		const secondPassImportedCalls: Record<string, Record<string, Set<number>>> = {};
		walkCallSites(
			node, source, fnScope, scopes, stateSet, derivedSet,
			componentNames, functionParamMap, new Map(),
			importSourceMap, secondPassImportedCalls,
		);
		for (const [specifier, fns] of Object.entries(secondPassImportedCalls)) {
			if (!importedReactiveCalls[specifier]) importedReactiveCalls[specifier] = {};
			for (const [fnName, idxSet] of Object.entries(fns)) {
				if (!importedReactiveCalls[specifier][fnName]) importedReactiveCalls[specifier][fnName] = new Set();
				for (const i of idxSet) importedReactiveCalls[specifier][fnName].add(i);
			}
		}
	}

	// Convert Set<number> to number[] for result
	const reactiveCalls: Record<string, Record<string, number[]>> = {};
	for (const [specifier, fns] of Object.entries(importedReactiveCalls)) {
		reactiveCalls[specifier] = {};
		for (const [fnName, indices] of Object.entries(fns)) {
			reactiveCalls[specifier][fnName] = [...indices];
		}
	}

	// Build reactiveCallTargets
	const reactiveCallTargets = new Map<string, Set<number>>();

	// Local functions with reactive params
	for (const [fnName, reactiveParamNames] of implicitReactiveParams) {
		const paramNames = functionParamMap.get(fnName) || [];
		const indices = new Set<number>();
		for (const rp of reactiveParamNames) {
			const idx = paramNames.indexOf(rp);
			if (idx >= 0) indices.add(idx);
		}
		if (indices.size > 0) reactiveCallTargets.set(fnName, indices);
	}

	// Imported functions with detected reactive call positions
	for (const [_specifier, fns] of Object.entries(reactiveCalls)) {
		for (const [fnName, indices] of Object.entries(fns)) {
			for (const [localName, info] of importSourceMap) {
				if (info.exportedName === fnName) {
					const existing = reactiveCallTargets.get(localName) || new Set();
					for (const idx of indices) existing.add(idx);
					reactiveCallTargets.set(localName, existing);
				}
			}
		}
	}

	// Cross-file reactive param info from Vite plugin
	if (reactiveCallImports) {
		for (const [fnName, indices] of Object.entries(reactiveCallImports)) {
			const existing = reactiveCallTargets.get(fnName) || new Set();
			for (const idx of indices) existing.add(idx);
			reactiveCallTargets.set(fnName, existing);
		}
	}

	return {
		ast,
		source,
		scope: moduleScope,
		root,
		scopes,
		components,
		componentNames,
		styles,
		reactiveExports,
		reactiveCalls,
		reactiveCallTargets,
		importSpecifiers,
		preprocessed: meta,
	};
}

// ── Binding Kind Upgrades ──────────────────────────────────────────

/**
 * Walk the AST and upgrade binding kinds from 'normal' to 'state'/'derived'
 * based on $$s/$$d sibling-declarator markers emitted by preprocess.
 *
 * Preprocess emits `let $$s = 0, name = expr` for state and
 * `const $$d = 0, name = expr` for derived. We detect the marker
 * declarator and upgrade the next sibling's binding.
 */
function upgradeBindingKinds(
	ast: Program,
	scopes: Map<AstNode, Scope>,
	stateSet: Set<string>,
	derivedSet: Set<string>,
	componentNames: Set<string>,
	meta: PreprocessResult,
): void {
	function upgradeMarkedDeclarations(varDecl: VariableDeclaration, scope: Scope, exported = false): void {
		let prevName: string | null = null;
		for (const decl of varDecl.declarations) {
			if (decl.id.type === 'Identifier') {
				const name = decl.id.name;

				// Skip marker declarators themselves, but remember their name
				if (name.startsWith(STATE_MARKER) || name.startsWith(DERIVED_MARKER)) {
					prevName = name;
					continue;
				}

				const binding = scope.get(name);
				if (!binding) continue;

				if (prevName?.startsWith(STATE_MARKER)) {
					binding.kind = 'state';
					binding.exported = exported;
					if (decl.init && isProxyInit(decl.init, scope)) binding.proxy = true;
				}
				if (prevName?.startsWith(DERIVED_MARKER)) {
					binding.kind = 'derived';
					binding.exported = exported;
				}
			} else if ((decl.id.type === 'ObjectPattern' || decl.id.type === 'ArrayPattern') && prevName?.startsWith(DERIVED_MARKER)) {
				// Derived destructuring: mark all identifiers in the pattern as derived
				upgradePatternBindings(decl.id, scope, 'derived', exported);
			}
			// Reset prevName after processing a non-marker declarator
			if (decl.id.type !== 'Identifier' || !(decl.id.name.startsWith(STATE_MARKER) || decl.id.name.startsWith(DERIVED_MARKER))) {
				prevName = null;
			}
		}
	}

	function upgradePatternBindings(node: any, scope: Scope, kind: 'state' | 'derived', exported: boolean): void {
		if (!node) return;
		if (node.type === 'Identifier') {
			const binding = scope.get(node.name);
			if (binding) { binding.kind = kind; binding.exported = exported; }
			return;
		}
		if (node.type === 'ObjectPattern') {
			for (const prop of node.properties || []) {
				if (prop?.type === 'RestElement') upgradePatternBindings(prop.argument, scope, kind, exported);
				else if (prop) upgradePatternBindings(prop.value, scope, kind, exported);
			}
			return;
		}
		if (node.type === 'ArrayPattern') {
			for (const elem of node.elements || []) {
				if (!elem) continue;
				if (elem.type === 'RestElement') upgradePatternBindings(elem.argument, scope, kind, exported);
				else upgradePatternBindings(elem, scope, kind, exported);
			}
			return;
		}
		if (node.type === 'AssignmentPattern') {
			upgradePatternBindings(node.left, scope, kind, exported);
			return;
		}
	}

	function visitStmts(stmts: ReadonlyArray<Directive | Statement>, scope: Scope): void {
		for (const stmt of stmts) {
			if (stmt.type === 'VariableDeclaration') {
				upgradeMarkedDeclarations(stmt, scope);
			}

			// Recurse into function bodies
			if (stmt.type === 'FunctionDeclaration' && stmt.body) {
				const fnScope = scopes.get(stmt) || scope;
				visitStmts(stmt.body.body, fnScope);
			}

			// Recurse into arrow/function expression bodies in variable declarations
			if (stmt.type === 'VariableDeclaration') {
				for (const decl of stmt.declarations) {
					const init = decl.init;
					if (init && init.type === 'ArrowFunctionExpression') {
						const fnScope = scopes.get(init) || scope;
						if (init.body.type === 'BlockStatement') {
							visitStmts(init.body.body, fnScope);
						}
					} else if (init && init.type === 'FunctionExpression') {
						const fnScope = scopes.get(init) || scope;
						if (init.body) {
							visitStmts(init.body.body, fnScope);
						}
					}
					// Also recurse into call expression arguments (e.g., createContext(() => { state x = 0; }))
					if (init && init.type === 'CallExpression') {
						visitExpression(init, scope);
					}
				}
			}

			// Recurse into blocks, loops, etc.
			if (stmt.type === 'BlockStatement') {
				const blockScope = scopes.get(stmt) || scope;
				visitStmts(stmt.body, blockScope);
			}

			// Recurse into if/else
			if (stmt.type === 'IfStatement') {
				if (stmt.consequent.type === 'BlockStatement') {
					const blockScope = scopes.get(stmt.consequent) || scope;
					visitStmts(stmt.consequent.body, blockScope);
				}
				if (stmt.alternate) {
					if (stmt.alternate.type === 'BlockStatement') {
						const blockScope = scopes.get(stmt.alternate) || scope;
						visitStmts(stmt.alternate.body, blockScope);
					} else {
						visitStmts([stmt.alternate], scope);
					}
				}
			}

			// Recurse into loops
			if (stmt.type === 'ForStatement' || stmt.type === 'ForInStatement' || stmt.type === 'ForOfStatement' || stmt.type === 'WhileStatement' || stmt.type === 'DoWhileStatement') {
				if (stmt.body.type === 'BlockStatement') {
					const blockScope = scopes.get(stmt.body) || scope;
					visitStmts(stmt.body.body, blockScope);
				}
			}

			// Recurse into switch cases
			if (stmt.type === 'SwitchStatement') {
				for (const c of stmt.cases) {
					visitStmts(c.consequent, scope);
				}
			}

			// Recurse into try/catch/finally
			if (stmt.type === 'TryStatement') {
				if (stmt.block) {
					const blockScope = scopes.get(stmt.block) || scope;
					visitStmts(stmt.block.body, blockScope);
				}
				if (stmt.handler?.body) {
					const blockScope = scopes.get(stmt.handler.body) || scope;
					visitStmts(stmt.handler.body.body, blockScope);
				}
				if (stmt.finalizer) {
					const blockScope = scopes.get(stmt.finalizer) || scope;
					visitStmts(stmt.finalizer.body, blockScope);
				}
			}

			// Export wrapped function declarations
			if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'FunctionDeclaration') {
				const fn = stmt.declaration;
				const fnScope = scopes.get(fn) || scope;
				if (fn.body) {
					visitStmts(fn.body.body, fnScope);
				}
			}
			if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration?.type === 'FunctionDeclaration') {
				const fn = stmt.declaration;
				const fnScope = scopes.get(fn) || scope;
				if (fn.body) {
					visitStmts(fn.body.body, fnScope);
				}
			}

			// Export wrapped variable declarations
			if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
				upgradeMarkedDeclarations(stmt.declaration, scope, true);
			}

			// Recurse into expression statements (e.g., describe(() => { ... }))
			if (stmt.type === 'ExpressionStatement') {
				visitExpression(stmt.expression, scope);
			}
		}
	}

	function visitExpression(expr: Expression, scope: Scope): void {
		if (expr.type === 'CallExpression') {
			for (const arg of expr.arguments) {
				if (arg.type !== 'SpreadElement') {
					visitExpression(arg, scope);
				}
			}
		} else if (expr.type === 'ArrowFunctionExpression') {
			const fnScope = scopes.get(expr) || scope;
			if (expr.body.type === 'BlockStatement') {
				visitStmts(expr.body.body, fnScope);
			}
		} else if (expr.type === 'FunctionExpression') {
			const fnScope = scopes.get(expr) || scope;
			if (expr.body) {
				visitStmts(expr.body.body, fnScope);
			}
		}
	}

	const moduleScope = scopes.get(ast) || new Scope(new ScopeRoot());
	visitStmts(ast.body, moduleScope);
}

/**
 * Mark cross-file reactive imports in the module scope.
 */
function markCrossFileReactiveImports(
	ast: Program,
	moduleScope: Scope,
	reactiveImports: Record<string, string[]>,
): void {
	for (const node of ast.body) {
		if (node.type !== 'ImportDeclaration') continue;
		const specifier = node.source.value;
		if (!specifier) continue;
		const reactiveNames = reactiveImports[specifier];
		if (!reactiveNames) continue;
		const reactiveSet = new Set(reactiveNames);
		for (const spec of node.specifiers) {
			if (spec.type === 'ImportSpecifier') {
				const importedName = spec.imported.type === 'Identifier'
					? spec.imported.name
					: spec.imported.value;
				if (reactiveSet.has(importedName)) {
					const localName = spec.local.name;
					const binding = moduleScope.get(localName);
					if (binding) {
						binding.kind = 'state';
					}
				}
			}
		}
	}
}

/**
 * Upgrade component parameter bindings to param/bind-prop/rest-prop kinds.
 */
function upgradeComponentParams(
	fnNode: OxcFunction,
	compScope: Scope,
	renamedParams: Record<string, string>,
	bindParamNames: string[],
): void {
	const bindSet = new Set(bindParamNames);

	// New format: first param is ObjectPattern ({x, y, ...rest})
	const firstParam = fnNode.params[0];
	if (firstParam && firstParam.type === 'ObjectPattern') {
		for (const prop of firstParam.properties) {
			if (prop.type === 'RestElement') {
				if (prop.argument.type === 'Identifier') {
					const binding = compScope.get(prop.argument.name);
					if (binding) binding.kind = 'rest-prop';
				}
				continue;
			}
			// Property — get local name from value (Identifier or AssignmentPattern)
			let localName: string | undefined;
			if (prop.value.type === 'Identifier') {
				localName = prop.value.name;
			} else if (prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier') {
				localName = prop.value.left.name;
			}
			if (!localName) continue;

			if (bindSet.has(localName)) {
				compScope.declare(localName, 'bind-prop', 'let');
			} else {
				const binding = compScope.get(localName);
				if (binding) binding.kind = 'prop';
			}
		}
	}
}

// ── Call-site Analysis ─────────────────────────────────────────────

/**
 * Walk AST looking for call expressions to detect which function params
 * receive reactive variables as arguments.
 */
function walkCallSites(
	ast: AstNode,
	source: string,
	moduleScope: Scope,
	scopes: Map<AstNode, Scope>,
	stateSet: Set<string>,
	derivedSet: Set<string>,
	componentNames: Set<string>,
	functionParamMap: Map<string, string[]>,
	localResult: Map<string, Set<string>>,
	importSourceMap: Map<string, { specifier: string; exportedName: string }>,
	importedResult: Record<string, Record<string, Set<number>>>,
): void {
	let activeScope: Scope = moduleScope;

	function isReactiveArg(arg: Argument): boolean {
		if (arg.type === 'Identifier') {
			const binding = activeScope.get(arg.name);
			return binding ? binding.reactive : false;
		}
		if (arg.type === 'MemberExpression') return isReactiveArg(arg.object);
		if (arg.type === 'ArrayExpression') {
			return arg.elements.some((el) => el !== null && isReactiveArg(el));
		}
		return false;
	}

	function visit(node: AstNode): void {
		// Switch scope on component function entry
		if (node.type === 'FunctionDeclaration' && node.id && componentNames.has(node.id.name)) {
			const prevScope = activeScope;
			activeScope = scopes.get(node) || activeScope;
			forEachChild(node, visit);
			activeScope = prevScope;
			return;
		}

		// Switch scope on any function entry
		if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
			const fnScope = scopes.get(node);
			if (fnScope) {
				const prevScope = activeScope;
				activeScope = fnScope;
				forEachChild(node, visit);
				activeScope = prevScope;
				return;
			}
		}

		if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
			const fnName = node.callee.name;
			const args = node.arguments;

			// Check calls to local functions
			const paramNames = functionParamMap.get(fnName);
			if (paramNames) {
				for (let i = 0; i < args.length && i < paramNames.length; i++) {
					if (isReactiveArg(args[i])) {
						if (!localResult.has(fnName)) localResult.set(fnName, new Set());
						localResult.get(fnName)!.add(paramNames[i]);
					}
				}
			}

			// Check calls to imported functions
			const importInfo = importSourceMap.get(fnName);
			if (importInfo) {
				for (let i = 0; i < args.length; i++) {
					if (isReactiveArg(args[i])) {
						if (!importedResult[importInfo.specifier]) importedResult[importInfo.specifier] = {};
						if (!importedResult[importInfo.specifier][importInfo.exportedName]) {
							importedResult[importInfo.specifier][importInfo.exportedName] = new Set();
						}
						importedResult[importInfo.specifier][importInfo.exportedName].add(i);
					}
				}
			}
		}

		forEachChild(node, visit);
	}

	visit(ast);
}

// ── Helpers ────────────────────────────────────────────────────────

interface FnInfo {
	name: string;
	node: OxcFunction;
	params: ParamPattern[];
	body: FunctionBody | null;
}

function extractFunctionDecl(node: AstNode): FnInfo | null {
	if (node.type === 'FunctionDeclaration' && node.id) {
		return { name: node.id.name, node, params: node.params, body: node.body };
	}
	if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
		const fn = node.declaration;
		return { name: fn.id?.name || 'default', node: fn, params: fn.params, body: fn.body };
	}
	if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
		const fn = node.declaration;
		if (!fn.id) return null;
		return { name: fn.id.name, node: fn, params: fn.params, body: fn.body };
	}
	return null;
}

/**
 * Detect whether a state initializer will produce a proxy at runtime.
 * Known non-proxyable types return false; identifiers are resolved recursively
 * through their bindings when possible (like Svelte's should_proxy).
 */
function isProxyInit(node: Expression, scope: Scope | null): boolean {
	switch (node.type) {
		case 'Literal':
		case 'TemplateLiteral':
		case 'ArrowFunctionExpression':
		case 'FunctionExpression':
		case 'UnaryExpression':
		case 'BinaryExpression':
		case 'LogicalExpression':
		case 'ConditionalExpression':
		case 'SequenceExpression':
		case 'TaggedTemplateExpression':
		case 'MemberExpression':
			return false;
		case 'Identifier':
			if (node.name === 'undefined') return false;
			if (scope) {
				const binding = scope.get(node.name);
				if (binding && !binding.reassigned && binding.initial) {
					return isProxyInit(binding.initial as Expression, null);
				}
			}
			return false;
		default:
			return true;
	}
}

/**
 * Find the JSX root in a component's return statement.
 */
function findReturnJSXRoot(fnNode: OxcFunction): JSXElement | JSXFragment | null {
	if (!fnNode.body) return null;
	for (const stmt of fnNode.body.body) {
		if (stmt.type === 'ReturnStatement' && stmt.argument) {
			let node: Expression = stmt.argument;
			while (node.type === 'ParenthesizedExpression') node = node.expression;
			if (node.type === 'JSXElement' || node.type === 'JSXFragment') return node;
		}
	}
	return null;
}

/** Get the tag name of a JSXElement if it has a simple JSXIdentifier name */
function getJSXTagName(node: JSXElement): string | null {
	const name = node.openingElement.name;
	return name.type === 'JSXIdentifier' ? name.name : null;
}

/**
 * Find a JSX marker element by name in a JSX tree.
 * Returns the element node if found, null otherwise.
 */
function findJSXMarkerElement(node: JSXElement | JSXFragment, markerName: string): JSXElement | null {
	if (node.type === 'JSXElement' && getJSXTagName(node) === markerName) {
		return node;
	}
	for (const child of node.children) {
		if (child.type === 'JSXElement') {
			const found = findJSXMarkerElement(child, markerName);
			if (found) return found;
		} else if (child.type === 'JSXFragment') {
			const found = findJSXMarkerElement(child, markerName);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Compute the path of element indices from the root JSX node to the
 * JSXElement that directly contains a style marker element.
 */
function computeStyleBlockScopePath(rootNode: JSXElement | JSXFragment, markerName: string): number[] {
	const path: number[] = [];

	function walk(node: JSXElement | JSXFragment): boolean {
		let elementIdx = 0;
		for (const child of node.children) {
			if (child.type === 'JSXElement') {
				if (getJSXTagName(child) === markerName) return true;
				if (findJSXMarkerElement(child, markerName)) {
					path.push(elementIdx);
					walk(child);
					return true;
				}
				elementIdx++;
			}
		}
		return false;
	}

	walk(rootNode);
	return path;
}

/** Known AST fields that contain child nodes */
const AST_CHILD_FIELDS = [
	'body', 'declarations', 'declaration', 'init', 'test', 'consequent',
	'alternate', 'expression', 'expressions', 'left', 'right', 'object',
	'property', 'callee', 'arguments', 'elements', 'properties', 'value',
	'argument', 'params', 'items', 'statements', 'block', 'handler',
	'finalizer', 'cases', 'discriminant', 'update', 'children',
	'openingElement', 'closingElement', 'attributes', 'specifiers',
	'source', 'key', 'id', 'label', 'tag', 'quasi', 'quasis',
];

const AST_CHILD_FIELD_SET = new Set(AST_CHILD_FIELDS);

/** Visit all AST child nodes of a given node */
function forEachChild(node: AstNode, fn: (child: AstNode) => void): void {
	for (const [key, value] of Object.entries(node)) {
		if (!AST_CHILD_FIELD_SET.has(key)) continue;
		if (value == null) continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (isAstNode(item)) fn(item);
			}
		} else if (isAstNode(value)) {
			fn(value);
		}
	}
}
